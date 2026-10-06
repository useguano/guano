import { test, expect } from '@playwright/test'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { boot, exitOf, instances } from './fixtures/server'

// Process lifecycle: the boot sweep, a graceful SIGTERM, and the forced exit
// on a second signal.
//
// Every test here spawns its OWN server on its own port and its own data dir,
// so it never touches the shared webServer or its first-run state — which is
// also why this file is exempt from the "must sort after smoke.spec.ts" rule
// that applies to specs logging into the shared instance.
//
// What it guards: `docker stop` during a publish used to kill the process
// wherever it stood, and the exporter's swap leaves NO live site if it is cut
// between its two renames. So the promise under test is "work that has already
// started finishes, then we exit".

test.afterEach(() => {
  for (const i of instances) i.stop()
  instances.length = 0
})

test('SIGTERM drains and exits clean, and the boot sweep is age-gated', async () => {
  // debris from a swap that was killed mid-flight, plus two directories the
  // sweep must NOT touch: a staging dir young enough to belong to a publish
  // another process is running right now, and the one-way migration's backup
  const fresh = `site.tmp-${Date.now()}`
  const srv = await boot('clean', 4391, {
    prepare: (dataDir) => {
      for (const d of ['site.old-1', 'preview.tmp-1', fresh, 'store.pre-v2']) {
        mkdirSync(join(dataDir, d), { recursive: true })
      }
    },
  })
  const left = readdirSync(srv.dataDir).sort()

  expect(left).not.toContain('site.old-1')
  expect(left).not.toContain('preview.tmp-1')
  expect(left).toContain(fresh) // too young to be anyone's debris but a live one's
  expect(left).toContain('store.pre-v2') // the only way back from the migration
  expect(srv.out()).toContain('swept 2 stale temp dir(s)')

  const health = await (await srv.api.get('/api/health')).json()
  expect(health.migrated).toBe(true) // the migration ran BEFORE the socket opened
  expect(health.status).toBe('degraded') // fresh instance: the store is empty
  expect(health.ok).toBe(true) // ...which must never read as unfit to serve

  srv.proc.kill('SIGTERM')
  expect(await exitOf(srv.proc)).toBe(0)
  expect(srv.out()).toContain('shutdown: SIGTERM — draining')
})

/**
 * A connection that is open when the signal arrives is CLOSED by the shutdown,
 * not severed by the process dying under it.
 *
 * The change feed is the right subject because it is deterministic: it is a
 * long-lived response that never ends on its own, so it is provably still open
 * when the signal lands. An export would be the more dramatic example, but a
 * seeded one finishes in ~25ms and racing it would make this test pass or fail
 * on how fast the machine is.
 *
 * It also covers the piece the drain cannot work without: without the explicit
 * close hook, server.close() waits on these responses — working exactly as
 * designed — for the whole deadline and then exits 1.
 */
test('an open connection is closed by the shutdown, and the exit is clean', async () => {
  const srv = await boot('inflight', 4393)
  const setup = await srv.api.post('/api/auth/setup', {
    data: { email: 'life@example.com', password: 'supersecret1', name: 'Lifecycle Co' },
  })
  expect(setup.ok()).toBeTruthy()

  // held open by the server until something ends it
  let settled = false
  const feed = srv.api.get('/api/events', { timeout: 60_000 }).then((r) => {
    settled = true
    return r
  })
  await new Promise((r) => setTimeout(r, 400))
  expect(settled, 'the change feed should stay open on its own').toBe(false)

  srv.proc.kill('SIGTERM')

  const res = await feed
  expect(res.status()).toBe(200)
  // told to go, rather than having the socket pulled from under it
  expect(await res.text()).toContain('event: shutdown')

  // 0 means both deadlines were met. Without a handler the process dies on the
  // signal and this reads 143; without the close hook the drain times out on a
  // response that was never going to end, and it reads 1.
  expect(await exitOf(srv.proc)).toBe(0)
})

test('a second signal stops pretending to be graceful', async () => {
  // the grace window holds the drain open long enough for a second signal to
  // land in it, which is what an impatient operator or an escalating
  // orchestrator actually does
  const srv = await boot('forced', 4395, { env: { SHUTDOWN_GRACE_MS: '5000' } })

  srv.proc.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 400))
  srv.proc.kill('SIGTERM')

  expect(await exitOf(srv.proc)).toBe(143) // 128 + SIGTERM, as a shell reports it
  expect(srv.out()).toContain('forcing exit')
})
