import { test, expect, request as pwRequest } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { boot, instances } from './fixtures/server'

// The first-run window.
//
// `POST /api/auth/setup` was gated on "no users exist" and nothing else, and
// the server binds EVERY interface — so on shared wifi, or on a VPS in the
// minutes before its owner opens /admin, the first stranger to reach it became
// the instance's admin and inherited every token `superbird connect --offline` had
// minted (`bindPendingTokens`). A data-dir wipe reopens that window on a
// machine that was already set up, which is a thing people do.
//
// Loopback stays free — the launcher, the dev server, the keyboard in front of
// the machine, all of which already hold the data dir. Every other address has
// to carry the code printed where the server was STARTED.
//
// Each test spawns its OWN server, so this file is exempt from the "sorts after
// smoke.spec.ts" rule (→ docs/gates.md): it never touches the shared
// instance's first-run state.

/** the address a stranger on the same network would reach this host by */
function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
}

test.afterEach(() => {
  for (const i of instances) i.stop()
  instances.length = 0
})

test('off this machine, the first account needs the code', async () => {
  const srv = await boot('setup-code', 4401)
  const codeFile = join(srv.dataDir, 'setup-code')

  // minted before the socket opened, 0600, and printed where it was started
  expect(existsSync(codeFile)).toBe(true)
  expect(statSync(codeFile).mode & 0o777).toBe(0o600)
  const code = readFileSync(codeFile, 'utf8').trim()
  expect(code).toHaveLength(32)
  expect(srv.out()).toContain(code)

  // loopback is told it needs nothing...
  const me = await (await srv.api.get('/api/auth/me')).json()
  expect(me.needsSetup).toBe(true)
  expect(me.setupCodeRequired).toBeUndefined()

  // ...and every other address is told it does. The server binds every
  // interface, so this reaches the same process over the address a stranger on
  // the same network would use — which is the whole point of the gate.
  test.skip(!lanAddress(), 'no non-loopback address on this host')
  const off = await pwRequest.newContext({ baseURL: `http://${lanAddress()}:${srv.port}` })
  const offMe = await (await off.get('/api/auth/me')).json()
  expect(offMe.setupCodeRequired).toBe(true)

  const bare = await off.post('/api/auth/setup', {
    data: { email: 'mallory@example.com', password: 'hunter2hunter2', projectName: 'Theirs' },
  })
  expect(bare.status()).toBe(403)
  expect((await bare.json()).error).toContain('setup code')

  const wrong = await off.post('/api/auth/setup', {
    data: { email: 'mallory@example.com', password: 'hunter2hunter2', setupCode: 'f'.repeat(32) },
  })
  expect(wrong.status()).toBe(403)

  // nothing was created by either attempt
  expect((await (await srv.api.get('/api/auth/me')).json()).needsSetup).toBe(true)

  // the real code works from anywhere — a VPS install is still possible
  const ok = await off.post('/api/auth/setup', {
    data: {
      email: 'owner@example.com',
      password: 'hunter2hunter2',
      projectName: 'Mine',
      setupCode: code,
    },
  })
  expect(ok.status()).toBe(200)
  expect((await ok.json()).role).toBe('admin')

  // the window is shut: the file is gone, and a second setup is refused
  expect(existsSync(codeFile)).toBe(false)
  const again = await srv.api.post('/api/auth/setup', {
    data: { email: 'second@example.com', password: 'hunter2hunter2' },
  })
  expect(again.status()).toBe(403)

  await off.dispose()
})

test('on this machine, setup needs no code and leaves none behind', async () => {
  const srv = await boot('setup-loopback', 4403)
  const res = await srv.api.post('/api/auth/setup', {
    data: { email: 'owner@example.com', password: 'hunter2hunter2', projectName: 'Mine' },
  })
  expect(res.status()).toBe(200)
  expect(existsSync(join(srv.dataDir, 'setup-code'))).toBe(false)
})
