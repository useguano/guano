import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// Phase 1 (MCP): per-user API tokens are a bearer credential for the MCP server.
// API-level spec on the same isolated server as the rest of the suite; it
// bootstraps its own users, so it does not depend on spec ordering.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const CONTRIB = { email: 'contrib@example.com', password: 'contrib-pass-1' }
const STORE_GET = '/api/store?keys=guano-project:main'

async function login(ctx: APIRequestContext, creds: { email: string; password: string }) {
  return ctx.post('/api/auth/login', { data: creds })
}

async function bearerCtx(baseURL: string | undefined, token: string) {
  return pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } })
}

test('API tokens: create via session, use as bearer, revoke kills it, contributor 403', async ({
  baseURL,
}) => {
  // --- admin session (create the first admin if this spec runs first) ---
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin, ADMIN)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  // --- create a token (cookie-authed) → raw token returned exactly once ---
  res = await admin.post('/api/tokens', { data: { name: 'mcp-e2e' } })
  expect(res.status()).toBe(200)
  const created = await res.json()
  expect(created.token).toMatch(/^guano_[0-9a-f]{48}$/)
  expect(created.id).toBeTruthy()
  const raw: string = created.token
  const id: string = created.id

  // a nameless token is rejected
  res = await admin.post('/api/tokens', { data: { name: '  ' } })
  expect(res.status()).toBe(400)

  // --- the bearer authorizes a store GET with NO cookie ---
  const bearer = await bearerCtx(baseURL, raw)
  res = await bearer.get(STORE_GET)
  expect(res.status()).toBe(200)

  // --- a garbage bearer is rejected ---
  const garbage = await bearerCtx(baseURL, 'guano_deadbeef')
  expect((await garbage.get(STORE_GET)).status()).toBe(401)

  // --- the token appears in the owner's list (no hash) ---
  const list = await (await admin.get('/api/tokens')).json()
  const row = list.tokens.find((t: { id: string }) => t.id === id)
  expect(row).toBeTruthy()
  expect(row.tokenHash).toBeUndefined()

  // --- revoke → the same bearer is now dead ---
  res = await admin.delete(`/api/tokens/${id}`)
  expect(res.status()).toBe(200)
  const revoked = await bearerCtx(baseURL, raw)
  expect((await revoked.get(STORE_GET)).status()).toBe(401)

  // --- a contributor cannot create tokens (403) ---
  res = await admin.post('/api/users/invite', {
    data: { name: 'Contrib', email: CONTRIB.email, role: 'contributor' },
  })
  let contribCtx: APIRequestContext
  if (res.ok()) {
    const { token } = await res.json()
    contribCtx = await pwRequest.newContext({ baseURL })
    res = await contribCtx.post(`/api/invite/${token}/accept`, { data: { password: CONTRIB.password } })
    expect(res.ok()).toBeTruthy()
  } else {
    contribCtx = await pwRequest.newContext({ baseURL })
    expect((await login(contribCtx, CONTRIB)).ok()).toBeTruthy()
  }
  res = await contribCtx.post('/api/tokens', { data: { name: 'nope' } })
  expect(res.status()).toBe(403)

  await admin.dispose()
  await bearer.dispose()
  await garbage.dispose()
  await revoked.dispose()
  await contribCtx.dispose()
})
