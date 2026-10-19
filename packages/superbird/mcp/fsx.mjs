// Atomic, private writes for the files `connect` and `disconnect` own.
//
// A client config holds a bearer token for every project connected on this
// machine, and it was written with a plain `writeFile` at the default mode: a
// crash or a full disk mid-write leaves a truncated config, which for the user
// means every OTHER MCP server they had configured is gone. tmp+rename makes
// the replacement one step instead.
//
// A file we CREATE is 0600, because we are the ones putting tokens in it. A
// file that already exists keeps the mode its owner gave it: rename replaces
// the inode, so the mode has to be carried across deliberately, and `connect`
// is not the authority on another application's permissions.
//
// Zero dependencies, like the rest of the package; `server/util.mjs` has the
// same shape but the MCP half must not import the server half.
import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeJsonAtomic(file, value) {
  let mode = 0o600
  try {
    mode = (await stat(file)).mode & 0o777
  } catch {
    /* new file — ours to make private */
  }
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  if (mode !== 0o600) await chmod(tmp, mode)
  await rename(tmp, file)
}
