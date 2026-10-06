// Zero-dependency ZIP writer/reader. Built on node:zlib raw deflate plus a
// hand-rolled CRC32 so the server keeps its no-deps posture. No zip64, no
// data descriptors, no encryption — the shapes we produce and consume are
// deliberately narrow (see createZip/readZip). Every path is a forward-slash
// relative path; readZip refuses anything that could escape a target dir.
import { deflateRawSync, inflateRawSync } from 'node:zlib'

// Decompression ceilings for READING an untrusted archive (a project-package
// import). Without them a "zip bomb" — a few KB of deflate that expands to
// gigabytes — is allocated in full before the size-mismatch check can reject
// it. Per-entry is enforced by zlib itself (maxOutputLength), cumulative by
// the running total in readZip.
const MAX_ENTRY_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_BYTES = 600 * 1024 * 1024

// ---------- CRC32 ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------- shared name guard ----------

/** true when a name is safe to unpack into a target directory */
function safeName(name) {
  if (!name || name.includes('\\')) return false
  if (name.startsWith('/')) return false
  if (name.includes(':')) return false
  return !name.split('/').some((seg) => seg === '..')
}

const MAX_U32 = 0xffffffff

// ---------- writer ----------

/** files: Array<{ path: string, data: Buffer }> → Buffer (the whole .zip) */
export function createZip(files) {
  if (files.length >= 65535) throw expose('too many entries for a non-zip64 archive')
  const locals = []
  const central = []
  let offset = 0

  for (const { path, data } of files) {
    const name = String(path).replace(/\\/g, '/')
    if (!safeName(name)) throw expose(`unsafe zip entry name: ${name}`)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    // store when deflate doesn't shrink (tiny/incompressible payloads)
    const deflated = deflateRawSync(data)
    const useDeflate = deflated.length < data.length
    const method = useDeflate ? 8 : 0
    const body = useDeflate ? deflated : data
    if (data.length > MAX_U32 || body.length > MAX_U32 || offset > MAX_U32) {
      throw expose('archive too large for a non-zip64 archive')
    }

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // gp flag: UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0, 12) // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18) // compressed size
    local.writeUInt32LE(data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    nameBuf.copy(local, 30)
    locals.push(local, body)

    const cen = Buffer.alloc(46 + nameBuf.length)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // version made by
    cen.writeUInt16LE(20, 6) // version needed
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(body.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30) // extra length
    cen.writeUInt16LE(0, 32) // comment length
    cen.writeUInt16LE(0, 34) // disk number
    cen.writeUInt16LE(0, 36) // internal attrs
    cen.writeUInt32LE(0, 38) // external attrs
    cen.writeUInt32LE(offset, 42) // local header offset
    nameBuf.copy(cen, 46)
    central.push(cen)

    offset += local.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // central dir disk
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16) // central dir offset
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuf, eocd])
}

// ---------- reader ----------

/** buf: Buffer → Array<{ path: string, data: Buffer }>; throws on malformed
 * or unsafe archives. Directory entries (names ending in '/') are skipped. */
export function readZip(buf) {
  const eocd = findEOCD(buf)
  if (eocd < 0) throw expose('not a zip archive (no end-of-central-directory)')
  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16) // central directory offset

  const out = []
  let totalBytes = 0
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw expose('corrupt central directory')
    }
    const flag = buf.readUInt16LE(ptr + 8)
    const method = buf.readUInt16LE(ptr + 10)
    const crc = buf.readUInt32LE(ptr + 16)
    const compSize = buf.readUInt32LE(ptr + 20)
    const uncompSize = buf.readUInt32LE(ptr + 24)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8')
    ptr += 46 + nameLen + extraLen + commentLen

    if (flag & 0x0001) throw expose('encrypted zip entries are not supported')
    if (name.endsWith('/')) continue // directory marker
    if (!safeName(name)) throw expose(`unsafe zip entry name: ${name}`)

    // read the local header to get the real name/extra lengths for this entry
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw expose('corrupt local header')
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const compressed = buf.subarray(dataStart, dataStart + compSize)

    // refuse before allocating: the declared size is the attacker's own claim,
    // so an honest bomb is rejected here and a lying one by maxOutputLength
    if (uncompSize > MAX_ENTRY_BYTES) throw expose(`entry too large: ${name}`)
    let data
    if (method === 0) data = Buffer.from(compressed)
    else if (method === 8) {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES })
      } catch {
        // RangeError once the cap is crossed mid-inflate, or a corrupt stream
        throw expose(`entry too large or corrupt: ${name}`)
      }
    } else throw expose(`unsupported compression method ${method}`)

    if (data.length !== uncompSize) throw expose(`size mismatch for ${name}`)
    if (crc32(data) !== crc) throw expose(`crc mismatch for ${name}`)
    totalBytes += data.length
    if (totalBytes > MAX_TOTAL_BYTES) throw expose('archive decompresses too large')
    out.push({ path: name, data })
  }
  return out
}

/** scan backwards over the trailing bytes for the EOCD signature */
function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557) // 22 + 0xffff comment max
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function expose(message) {
  const err = new Error(message)
  err.expose = true
  return err
}
