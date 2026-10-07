import { test, expect, request as pwRequest } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, instances } from './fixtures/server'

// A token minted BEFORE the first account exists.
//
// `npm create @useguano` connects Claude Desktop at scaffold time, before the
// server has ever run: it writes a PENDING api-token record (`userId: null`,
// `pendingFirstAdmin: true`) and the agent policy into the data dir. The
// server must (1) refuse that token until setup, (2) show the preset policy to
// the setup form so it does not ask again, and (3) bind the token to the
// first admin the moment that account is created. A server of its own, since
// the token file is read once at boot.

const RAW = 'guano_' + randomBytes(24).toString('hex')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

function pendingRecord() {
  return {
    id: randomBytes(12).toString('hex'),
    tokenHash: sha256(RAW),
    userId: null,
    name: 'guano connect (Claude Desktop)',
    createdAt: Date.now(),
    lastUsedAt: null,
    pendingFirstAdmin: true,
  }
}

/** a request context with NO cookies: the setup call leaves a session cookie
 *  in the shared one, and a session beside a bearer reads as the session —
 *  which is not what an agent's call looks like */
const bare = (port: number) => pwRequest.newContext({ baseURL: `http://localhost:${port}` })

test.afterEach(() => {
  for (const i of instances) i.stop()
  instances.length = 0
})

test('a pending token is refused before setup, shown as preset, and bound to the first admin', async () => {
  const srv = await boot('pending-token', 4401, {
    prepare: (dataDir) => {
      writeFileSync(join(dataDir, 'api-tokens.json'), JSON.stringify([pendingRecord()]), { mode: 0o600 })
      writeFileSync(
        join(dataDir, 'agent-policy.json'),
        JSON.stringify({ allowMainWrites: true, allowPublish: false }),
        { mode: 0o600 },
      )
    },
  })

  // the banner names the waiting token
  expect(srv.out()).toContain('the Claude Desktop token you created is bound to it')

  // (2) the setup form learns the preset answers from the unauthenticated /me
  const me = await srv.api.get('/api/auth/me')
  expect(me.status()).toBe(401)
  expect(await me.json()).toEqual({
    needsSetup: true,
    agentPolicy: { allowMainWrites: true, allowPublish: false },
  })

  const agent = await bare(srv.port)
  // (1) nobody owns it yet, so it authenticates nobody
  const before = await agent.get('/api/auth/me', { headers: { authorization: `Bearer ${RAW}` } })
  expect(before.status()).toBe(401)

  // setup WITHOUT agentPolicy in the body — the form does not re-ask
  const setup = await srv.api.post('/api/auth/setup', {
    data: { email: 'owner@example.com', password: 'supersecret1', name: 'Owner', projectName: 'Pending Co' },
  })
  expect(setup.status(), await setup.text()).toBe(200)

  // (3) the same raw token now IS the admin, and the preset policy survived
  const after = await agent.get('/api/auth/me', { headers: { authorization: `Bearer ${RAW}` } })
  expect(after.status(), await after.text()).toBe(200)
  const profile = await after.json()
  expect(profile.role).toBe('admin')
  expect(profile.email).toBe('owner@example.com')
  expect(profile.agentPolicy).toMatchObject({ allowMainWrites: true, allowPublish: false })

  // and the record on disk is an ordinary one now
  const stored = JSON.parse(readFileSync(join(srv.dataDir, 'api-tokens.json'), 'utf8'))
  expect(stored).toHaveLength(1)
  expect(stored[0].userId).toBe(profile.id)
  expect(stored[0].pendingFirstAdmin).toBeUndefined()
})

test('a fresh instance exposes no preset, and connect mints a pending token with no admin', async () => {
  const srv = await boot('pending-connect', 4403)

  const me = await srv.api.get('/api/auth/me')
  expect(me.status()).toBe(401)
  expect(await me.json()).toEqual({ needsSetup: true })

  // `guano connect` against a running server with no account yet
  const nonce = randomBytes(32).toString('hex')
  writeFileSync(join(srv.dataDir, '.connect-nonce'), nonce, { mode: 0o600 })
  const res = await srv.api.post('/api/auth/connect', {
    data: { nonce, name: 'test connect', policy: { allowPublish: true } },
  })
  expect(res.status(), await res.text()).toBe(200)
  const minted = await res.json()
  expect(minted.pending).toBe(true)
  expect(minted.email).toBeNull()
  expect(minted.token).toMatch(/^guano_[0-9a-f]{48}$/)
  expect(minted.agentPolicy).toMatchObject({ allowMainWrites: false, allowPublish: true })

  // the policy it wrote is now the preset the setup form sees
  expect(await (await srv.api.get('/api/auth/me')).json()).toEqual({
    needsSetup: true,
    agentPolicy: { allowMainWrites: false, allowPublish: true },
  })

  // unusable until setup, usable right after
  const agent = await bare(srv.port)
  expect((await agent.get('/api/auth/me', { headers: { authorization: `Bearer ${minted.token}` } })).status()).toBe(401)
  const setup = await srv.api.post('/api/auth/setup', {
    data: { email: 'owner@example.com', password: 'supersecret1', name: 'Owner', projectName: 'X' },
  })
  expect(setup.status()).toBe(200)
  const after = await agent.get('/api/auth/me', { headers: { authorization: `Bearer ${minted.token}` } })
  expect(after.status()).toBe(200)
  const profile = await after.json()
  expect(profile.role).toBe('admin')
  expect(profile.agentPolicy).toMatchObject({ allowMainWrites: false, allowPublish: true })
})
