// The render referee for the tree-source migration.
//
// The migration retires the indentation DSL and makes the ElementNode tree the
// only source of truth for page structure. Every phase of it is a rewrite of
// code that decides what the published site looks like, and the one property
// that must hold throughout is: the exported HTML does not change. Nothing else
// proves that — `vue-tsc` sees well-typed trees either way, and the e2e suite
// renders a handful of pages.
//
// So: a fixed set of input projects, exported through `server/export.mjs`, with
// every output file hashed. `check` re-exports and diffs. A difference is a bug,
// never a re-baseline.
//
// It also snapshots node IDENTITY per project (`identity.json`): node ids are
// addressed by comment anchors, interaction `targetId`s and the 3-way merge
// base, so a migration that renders identically while re-minting ids has still
// broken the project. Identity is compared the same way.
//
//   node scripts/corpus.mjs build [--force]   construct/refresh the input projects
//   node scripts/corpus.mjs media [--from d]  snapshot the media they reference
//   node scripts/corpus.mjs save              export every input → .corpus/baseline/
//   node scripts/corpus.mjs check             export every input → .corpus/check/, diff
//   node scripts/corpus.mjs                   build (if needed) then save
//
// The inputs live in `.corpus/inputs/` and are the referee, NOT the code that
// built them: each phase changes how a project is constructed, so rebuilding
// from source after a change would compare a different project to itself. Build
// once and leave `.corpus/` alone — `build` refuses to overwrite existing
// inputs without --force for exactly that reason.
//
// The saved inputs are v1 captures (`page.code` beside the tree). `check` runs
// each one through `migrateProject` before exporting, because what has to be
// byte-identical is what the app renders from them TODAY.
//
// MEDIA is part of the referee. A `/media/<id>` reference is resolved by
// `export-media.mjs` out of `$GUANO_DATA_DIR/media`, so a referee that read the
// live data dir compared against whatever happened to be on this machine: the
// baseline's 305 extracted files came from one dev store, and `check` on a
// fresh clone diffed every one of them as missing — a failure that looks
// exactly like the bug it exists to catch. So `build` (and `media`) snapshots
// the referenced bytes into `.corpus/media/`, and every export points
// GUANO_DATA_DIR at `.corpus`. An input that references an id the
// snapshot does not hold REFUSES to run rather than exporting a hole.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CORPUS = join(ROOT, '.corpus')
const INPUTS = join(CORPUS, 'inputs')

const RUNTIME = join(ROOT, 'packages/guano/runtime/mcp-runtime.mjs')

// where `media` reads from by default: whatever data dir the caller points at,
// else the repo's own. Captured BEFORE exportInto repoints GUANO_DATA_DIR at
// the snapshot.
const DATA_DIR_DEFAULT = process.env.GUANO_DATA_DIR || join(ROOT, 'server', 'data')

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

// ---------- building the input projects ----------

/**
 * Deterministic ids.
 *
 * Node's global `crypto` is not the object `globalThis.crypto` resolves to, so
 * the uuid minting inside the bundle can't be stubbed. Instead every uuid in
 * the finished blob is renumbered in order of first appearance — they are
 * unique tokens in the JSON, so a whole-text substitution is exact. Two runs of
 * the same construction code then produce byte-identical input, which is what
 * makes a saved baseline comparable at all.
 */
function canonicalizeIds(project) {
  const text = JSON.stringify(project)
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
  const seen = new Map()
  for (const match of text.match(UUID) ?? []) {
    if (!seen.has(match)) {
      const n = seen.size
      seen.set(match, `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
    }
  }
  let out = text
  for (const [from, to] of seen) out = out.split(from).join(to)
  return JSON.parse(out)
}

/** every stored project blob in a local `server/data` store, if there is one */
async function storeProjects() {
  const dir = join(ROOT, 'server/data/store')
  if (!existsSync(dir)) return []
  const out = []
  for (const file of (await readdir(dir)).sort()) {
    // keys map to filenames by ':' → '__'; merge bases are full project copies
    // and carry the same structure, so they are corpus members in their own right
    if (!/^guano-(project|base)__.+\.json$/.test(file)) continue
    const raw = JSON.parse(await readFile(join(dir, file), 'utf8'))
    const project = raw?.pages ? raw : raw?.value
    if (!project?.pages?.length) continue
    out.push([`store-${file.replace(/\.json$/, '').replace(/^guano-/, '')}`, project])
  }
  return out
}

async function buildInputs({ force }) {
  if (existsSync(INPUTS) && !force) {
    const have = (await readdir(INPUTS)).filter((f) => f.endsWith('.json'))
    if (have.length) {
      console.log(`inputs exist (${have.length}) — pass --force to rebuild them`)
      return
    }
  }
  const rt = await import(RUNTIME)
  await mkdir(INPUTS, { recursive: true })

  const projects = [
    ['fixture', JSON.parse(await readFile(join(ROOT, 'e2e/fixtures/project.json'), 'utf8'))],
    ...(await storeProjects()),
  ]
  for (const [name, project] of projects) {
    const text = JSON.stringify(project, null, 2)
    await writeFile(join(INPUTS, `${name}.json`), text)
    console.log(
      `input  ${name.padEnd(24)} ${project.pages.length} pages, ` +
        `${(project.components ?? []).length} components, ${(text.length / 1024) | 0} KB`,
    )
  }
}

// ---------- exporting + snapshotting ----------

/**
 * Node identity per page and per component master: id, type, parent and index.
 *
 * Flat rather than nested so a diff points at the node that moved, and ordered
 * by a pre-order walk so two runs line up.
 */
function identitySnapshot(project) {
  const out = { pages: {}, components: {} }
  const walk = (nodes, parentId, into) => {
    nodes.forEach((node, index) => {
      into.push([node.id, node.type, parentId, index])
      walk(node.children ?? [], node.id, into)
    })
  }
  for (const page of project.pages ?? []) {
    const rows = []
    walk(page.elements ?? [], null, rows)
    out.pages[page.id] = rows
  }
  for (const def of project.components ?? []) {
    const rows = []
    walk([def.root], null, rows)
    out.components[def.id] = rows
  }
  return out
}

async function manifestOf(dir) {
  const files = {}
  const walk = async (at) => {
    for (const entry of (await readdir(at, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) await walk(full)
      else files[relative(dir, full)] = sha256(await readFile(full))
    }
  }
  await walk(dir)
  return files
}

// ---------- media: the referee's own copy ----------

const MEDIA_RE = /\/media\/([a-f0-9]{16})/g

/** every `/media/<id>` id any input references, from the raw JSON — a whole-text
 *  scan, because the refs live in a dozen different places (a node's src,
 *  background and link, rich copy, entry values, favicons, @font-face) and the
 *  referee only needs the SET */
async function referencedMediaIds() {
  const ids = new Set()
  const names = (await readdir(INPUTS)).filter((f) => f.endsWith('.json'))
  for (const file of names) {
    const text = await readFile(join(INPUTS, file), 'utf8')
    for (const [, id] of text.matchAll(MEDIA_RE)) ids.add(id)
  }
  return ids
}

/**
 * Copy the bytes every input references into `.corpus/media/`, in the
 * media-library layout `export-media.mjs` reads (`index.json` + `files/<id>`).
 *
 * `from` is a data dir — the live one by default, or a backup. Only the
 * referenced assets are copied, and the index is rewritten to exactly those, so
 * the snapshot is reproducible and does not grow with the dev store.
 */
async function snapshotMedia({ from } = {}) {
  const source = from ?? DATA_DIR_DEFAULT
  const ids = await referencedMediaIds()
  const dest = join(CORPUS, 'media')
  if (!ids.size) {
    await rm(dest, { recursive: true, force: true })
    console.log('media: no inputs reference the library — nothing to snapshot')
    return
  }
  let index = { assets: [] }
  try {
    index = JSON.parse(await readFile(join(source, 'media', 'index.json'), 'utf8'))
  } catch {
    throw new Error(
      `media: no library index at ${join(source, 'media', 'index.json')} — point --from at a ` +
        'data dir that holds the assets these inputs reference',
    )
  }
  const byId = new Map((index.assets ?? []).map((a) => [a.id, a]))
  await rm(dest, { recursive: true, force: true })
  await mkdir(join(dest, 'files'), { recursive: true })
  const kept = []
  const missing = []
  for (const id of [...ids].sort()) {
    const asset = byId.get(id)
    if (!asset) {
      missing.push(id)
      continue
    }
    try {
      await writeFile(join(dest, 'files', id), await readFile(join(source, 'media', 'files', id)))
    } catch {
      missing.push(id)
      continue
    }
    kept.push(asset)
  }
  await writeFile(join(dest, 'index.json'), JSON.stringify({ assets: kept, folders: [] }, null, 1))
  console.log(`media: snapshotted ${kept.length} asset(s) from ${source}`)
  if (missing.length) {
    console.warn(
      `media: ${missing.length} referenced asset(s) are not in that data dir ` +
        `(${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''}). ` +
        'The baseline will export them as dropped media.',
    )
  }
}

/**
 * Refuse to export against a media snapshot that cannot answer the inputs.
 *
 * Without this the export drops the asset with a warning and the diff blames
 * the code — which is the one thing a referee must never do.
 */
async function requireMedia() {
  const ids = await referencedMediaIds()
  if (!ids.size) return
  const dest = join(CORPUS, 'media')
  let index = null
  try {
    index = JSON.parse(await readFile(join(dest, 'index.json'), 'utf8'))
  } catch {
    throw new Error(
      `the inputs reference ${ids.size} media asset(s) and ${dest} does not exist.\n` +
        'Run `node scripts/corpus.mjs media --from <data dir>` once (the dir that holds them —\n' +
        'a backup is fine), and commit nothing: .corpus is gitignored and local to this machine.',
    )
  }
  const have = new Set((index.assets ?? []).map((a) => a.id))
  const gone = [...ids].filter((id) => !have.has(id))
  if (gone.length) {
    throw new Error(
      `the media snapshot is missing ${gone.length} asset(s) the inputs reference ` +
        `(${gone.slice(0, 4).join(', ')}${gone.length > 4 ? ', …' : ''}).\n` +
        'Re-run `node scripts/corpus.mjs media --from <data dir>`.',
    )
  }
}

async function exportInto(outRoot) {
  await requireMedia()
  // the snapshot IS the data dir for the export — set before the import,
  // because server/util.mjs reads GUANO_DATA_DIR at module load
  process.env.GUANO_DATA_DIR = CORPUS
  const { exportSite } = await import(join(ROOT, 'server/export.mjs'))
  const rt = await import(RUNTIME)
  // the referee is the MIGRATED input's render: the saved inputs are v1 blobs
  // (captured before the migration existed), and what has to be byte-identical
  // is what the app renders from them TODAY
  const migrate = rt.migrateProject
    ? (project) => rt.migrateProject(project).project
    : (project) => project

  const names = (await readdir(INPUTS)).filter((f) => f.endsWith('.json')).sort()
  if (!names.length) throw new Error('no corpus inputs — run `node scripts/corpus.mjs build`')

  for (const file of names) {
    const name = file.replace(/\.json$/, '')
    const project = migrate(JSON.parse(await readFile(join(INPUTS, file), 'utf8')))
    const dir = join(outRoot, name)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const stats = await exportSite(project, join(dir, 'site'))
    await writeFile(
      join(dir, 'identity.json'),
      JSON.stringify(identitySnapshot(project), null, 1),
    )
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify(await manifestOf(join(dir, 'site')), null, 1),
    )
    console.log(`export ${name.padEnd(24)} ${stats.routes} routes, ${(stats.bytes / 1024) | 0} KB`)
  }
}

// ---------- the check ----------

/**
 * First few differing lines of two text files.
 *
 * Exported HTML is one long line, so a line's PREFIX says nothing — the window
 * is centred on the first character that differs instead.
 */
function textDiff(before, after, limit = 4) {
  const a = before.split('\n')
  const b = after.split('\n')
  const out = []
  const window = (line, from) => {
    const start = Math.max(0, from - 60)
    return (
      (start ? '…' : '') +
      line.slice(start, from + 140).replace(/\n/g, '⏎') +
      (from + 140 < line.length ? '…' : '')
    )
  }
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit * 2; i++) {
    if (a[i] === b[i]) continue
    let at = 0
    while (at < (a[i]?.length ?? 0) && a[i][at] === b[i]?.[at]) at++
    out.push(`      @ line ${i + 1} col ${at + 1}`)
    if (a[i] !== undefined) out.push(`      - ${window(a[i], at)}`)
    if (b[i] !== undefined) out.push(`      + ${window(b[i], at)}`)
  }
  return out
}

const TEXT = /\.(html|css|js|json|svg|txt|xml)$/

async function compare(name, baseDir, checkDir) {
  const problems = []
  const read = async (dir, rel) => {
    try {
      return JSON.parse(await readFile(join(dir, rel), 'utf8'))
    } catch {
      return null
    }
  }
  const before = await read(baseDir, 'manifest.json')
  const after = await read(checkDir, 'manifest.json')
  if (!before) return [`${name}: no baseline (run \`save\` on the pre-change commit)`]

  const paths = [...new Set([...Object.keys(before), ...Object.keys(after ?? {})])].sort()
  for (const rel of paths) {
    if (before[rel] === after?.[rel]) continue
    if (!after?.[rel]) {
      problems.push(`${name}: site/${rel} disappeared`)
      continue
    }
    if (!before[rel]) {
      problems.push(`${name}: site/${rel} is new`)
      continue
    }
    problems.push(`${name}: site/${rel} changed`)
    if (TEXT.test(rel)) {
      const [a, b] = await Promise.all([
        readFile(join(baseDir, 'site', rel), 'utf8').catch(() => ''),
        readFile(join(checkDir, 'site', rel), 'utf8').catch(() => ''),
      ])
      problems.push(...textDiff(a, b))
    }
  }

  // identity: a node that renders the same but was re-minted still breaks
  // comment anchors, interaction targets and the merge base
  const idA = await read(baseDir, 'identity.json')
  const idB = await read(checkDir, 'identity.json')
  if (idA && idB) {
    for (const kind of ['pages', 'components']) {
      const keys = [...new Set([...Object.keys(idA[kind]), ...Object.keys(idB[kind])])].sort()
      for (const key of keys) {
        const a = JSON.stringify(idA[kind][key] ?? null)
        const b = JSON.stringify(idB[kind][key] ?? null)
        if (a === b) continue
        const rowsA = idA[kind][key] ?? []
        const rowsB = idB[kind][key] ?? []
        const lostIds = rowsA.filter((r) => !rowsB.some((s) => s[0] === r[0]))
        problems.push(
          `${name}: identity of ${kind.slice(0, -1)} ${key} changed ` +
            `(${rowsA.length} → ${rowsB.length} nodes, ${lostIds.length} ids lost)`,
        )
        for (const row of lostIds.slice(0, 5)) problems.push(`      - ${row.join(' ')}`)
      }
    }
  }
  return problems
}

async function check() {
  const checkRoot = join(CORPUS, 'check')
  await exportInto(checkRoot)
  const names = (await readdir(INPUTS)).filter((f) => f.endsWith('.json')).sort()
  let problems = []
  for (const file of names) {
    const name = file.replace(/\.json$/, '')
    problems = problems.concat(
      await compare(name, join(CORPUS, 'baseline', name), join(checkRoot, name)),
    )
  }
  if (!problems.length) {
    console.log(`\nOK — ${names.length} projects render byte-identically, identity preserved`)
    return 0
  }
  console.error('')
  for (const line of problems) console.error(line)
  console.error(`\nFAIL — ${problems.filter((p) => !p.startsWith('    ')).length} differences`)
  return 1
}

// ---------- cli ----------

const [, , ...argv] = process.argv
const cmd = argv.find((a) => !a.startsWith('--')) ?? 'default'
const force = argv.includes('--force')

const fromAt = argv.indexOf('--from')
const from = fromAt !== -1 && argv[fromAt + 1] ? resolve(argv[fromAt + 1]) : undefined

let code = 0
if (cmd === 'build') {
  await buildInputs({ force })
  await snapshotMedia({ from })
} else if (cmd === 'media') await snapshotMedia({ from })
else if (cmd === 'save') await exportInto(join(CORPUS, 'baseline'))
else if (cmd === 'check') code = await check()
else if (cmd === 'default') {
  await buildInputs({ force })
  await snapshotMedia({ from })
  await exportInto(join(CORPUS, 'baseline'))
} else {
  console.error(
    'usage: node scripts/corpus.mjs [build|media|save|check] [--force] [--from <data dir>]',
  )
  code = 2
}
process.exit(code)
