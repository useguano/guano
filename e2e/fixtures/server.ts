import { request as pwRequest, type APIRequestContext } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

// A server of one's own.
//
// Some things cannot be asserted against the shared webServer: a SIGTERM would
// end the suite, and a record planted on disk before boot is the only way to
// test what the server does with one (its user cache reads once). So these
// specs spawn their own process on their own port and data dir.

const REPO = resolve(import.meta.dirname, '..', '..')

export interface Instance {
  proc: ChildProcess
  port: number
  dataDir: string
  out: () => string
  stop: () => void
}

// every instance spawned, so a spec can tear them all down
export const instances: Instance[] = []

/** spawn a server, wait until /api/health answers, and return a handle.
 * `prepare` runs against the freshly made data dir, before the spawn — which
 * is the only window in which a test can plant something for boot to find. */
export async function boot(
  name: string,
  port: number,
  opts: { env?: Record<string, string>; prepare?: (dataDir: string) => void } = {},
) {
  const dataDir = join(REPO, `.e2e-lifecycle-${name}`)
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  opts.prepare?.(dataDir)

  let output = ''
  const proc = spawn(process.execPath, ['server/index.mjs'], {
    cwd: REPO,
    env: {
      ...process.env,
      GUANO_DATA_DIR: dataDir,
      PORT: String(port),
      PORT_STRICT: '1', // never walk: the test owns this port or it fails
      LOG_LEVEL: 'info',
      ...opts.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout?.on('data', (c) => (output += String(c)))
  proc.stderr?.on('data', (c) => (output += String(c)))

  const instance: Instance = {
    proc,
    port,
    dataDir,
    out: () => output,
    stop: () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
  instances.push(instance)

  const api = await pwRequest.newContext({ baseURL: `http://localhost:${port}` })
  for (let i = 0; i < 160; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited early:\n${output}`)
    try {
      if ((await api.get('/api/health')).ok()) return { ...instance, api }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 125))
  }
  throw new Error(`server never became healthy:\n${output}`)
}

/** resolves with the exit code once the process is gone */
export function exitOf(proc: ChildProcess, timeoutMs = 40_000) {
  return new Promise<number | null>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('process did not exit')), timeoutMs)
    proc.once('exit', (code, signal) => {
      clearTimeout(timer)
      // a signalled death reports code null; surface it as 128+n the way a
      // shell does, so the assertions can tell the two apart
      res(code ?? (signal === 'SIGKILL' ? 137 : signal === 'SIGTERM' ? 143 : null))
    })
  })
}


/** kill and clean every instance this file started */
export function stopAll(list: Instance[]) {
  for (const i of list) i.stop()
}
