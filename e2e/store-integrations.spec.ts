import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// Integrations: a named set of keys, stored SERVER-SIDE, each key secret
// (write-once, masked) or plain (readable and substituted into custom code).
//
// The split of authority here is the whole security model, so it is what this
// spec asserts: an agent token reads NAMES, an editor reads names, only an
// admin at a browser writes, and a secret VALUE never comes back to anyone.
//
// Sorts after smoke.spec.ts, which owns the first-run flow.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
/** a value no response, export or log may ever contain */
const SECRET = 'sk_live_NEVER_LEAK_ME'

async function adminContext(baseURL?: string) {
  const ctx = await pwRequest.newContext({ baseURL })
  let res = await ctx.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    res = await ctx.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }
  return ctx
}

/** a second user at the given role, with their own session */
async function userContext(admin: APIRequestContext, baseURL: string | undefined, role: string) {
  const email = `${role}-ig@example.com`
  const invite = await admin.post('/api/users/invite', {
    data: { name: role, email, role },
  })
  expect(invite.ok()).toBeTruthy()
  const { token } = await invite.json()
  const ctx = await pwRequest.newContext({ baseURL })
  expect((await ctx.post(`/api/invite/${token}/accept`, { data: { password: ADMIN.password } })).ok())
    .toBeTruthy()
  return ctx
}

async function tokenContext(admin: APIRequestContext, baseURL: string | undefined) {
  const res = await admin.post('/api/tokens', { data: { name: 'ig-spec' } })
  expect(res.ok()).toBeTruthy()
  const { token } = await res.json()
  return pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  })
}

test('an integration is a named set of keys, and a secret value never leaves the server', async ({
  baseURL,
}) => {
  const admin = await adminContext(baseURL)

  const created = await admin.post('/api/integrations', { data: { name: 'Postmark' } })
  expect(created.ok()).toBeTruthy()
  const { id } = await created.json()

  await admin.put(`/api/integrations/${id}/keys/HOST`, {
    data: { value: 'smtp.postmarkapp.com', secret: false },
  })
  const withSecret = await admin.put(`/api/integrations/${id}/keys/PASSWORD`, {
    data: { value: SECRET, secret: true },
  })
  expect(withSecret.ok()).toBeTruthy()

  const list = await (await admin.get('/api/integrations')).text()
  // the plain half is readable (custom code references it), the secret half is
  // reported by NAME and nothing else
  expect(list).toContain('smtp.postmarkapp.com')
  expect(list).toContain('"name":"PASSWORD"')
  expect(list).not.toContain(SECRET)
  // the env prefix the panel shows and the exporter resolves
  expect(list).toContain('"env":"POSTMARK"')

  // a secret can never be turned plain: it was promised never shown again, and
  // a plain key is substituted into a public page
  const flip = await admin.put(`/api/integrations/${id}/keys/PASSWORD`, {
    data: { value: 'x', secret: false },
  })
  expect(flip.status()).toBe(400)
  expect((await flip.json()).error).toContain('delete it and add it again')

  // names that would collide in `{{ENV.…}}` are refused, or a reference is
  // ambiguous between two integrations
  await admin.post('/api/integrations', { data: { name: 'Post mark' } })
  const collide = await admin.post('/api/integrations', { data: { name: 'Post-mark' } })
  expect(collide.status()).toBe(400)
  expect((await collide.json()).error).toContain('collides')

  // key names are UPPER_SNAKE_CASE, and a value cannot carry a newline (which
  // is how a header injection would start)
  expect((await admin.put(`/api/integrations/${id}/keys/bad-key%21`, { data: { value: 'x' } })).status())
    .toBe(400)
  const nl = await admin.put(`/api/integrations/${id}/keys/MULTI`, {
    data: { value: 'a\nb', secret: false },
  })
  expect(nl.status()).toBe(400)
  expect((await nl.json()).error).toContain('newlines')

  await admin.delete(`/api/integrations/${id}`)
  await admin.dispose()
})

test('reads are editor+, writes are admin-at-a-browser only', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const created = await admin.post('/api/integrations', { data: { name: 'Shared' } })
  const { id } = await created.json()
  await admin.put(`/api/integrations/${id}/keys/API_KEY`, { data: { value: SECRET, secret: true } })
  await admin.put(`/api/integrations/${id}/keys/REGION`, { data: { value: 'eu', secret: false } })

  // an EDITOR reads (they write the custom code that references a key) and
  // cannot change anything
  const editor = await userContext(admin, baseURL, 'editor')
  const editorRead = await editor.get('/api/integrations')
  expect(editorRead.ok()).toBeTruthy()
  const editorText = await editorRead.text()
  expect(editorText).toContain('"name":"API_KEY"')
  expect(editorText).toContain('eu')
  expect(editorText).not.toContain(SECRET)
  expect((await editor.post('/api/integrations', { data: { name: 'Nope' } })).status()).toBe(403)
  expect((await editor.delete(`/api/integrations/${id}`)).status()).toBe(403)
  // and form settings are admin-only outright: recipients and retention are
  // decisions about other people's personal data
  expect((await editor.get('/api/forms-config')).status()).toBe(403)

  // a CONTRIBUTOR sees none of it
  const contributor = await userContext(admin, baseURL, 'contributor')
  expect((await contributor.get('/api/integrations')).status()).toBe(403)

  // an AGENT TOKEN reads names (it needs them to write a valid {{ENV.X}}) and
  // can never write — a credential that could mint a credential guards nothing
  const agent = await tokenContext(admin, baseURL)
  const agentRead = await agent.get('/api/integrations')
  expect(agentRead.ok()).toBeTruthy()
  const agentText = await agentRead.text()
  expect(agentText).toContain('"name":"API_KEY"')
  expect(agentText).not.toContain(SECRET)
  // 401, not 403: a write here requires a browser SESSION, and a bearer token
  // simply is not one — the same answer /api/agent-policy gives a token, for
  // the same reason (a credential able to mint credentials guards nothing)
  expect((await agent.post('/api/integrations', { data: { name: 'AgentMade' } })).status()).toBe(401)
  expect((await agent.put(`/api/integrations/${id}`, { data: { name: 'Renamed' } })).status()).toBe(401)
  expect((await agent.delete(`/api/integrations/${id}`)).status()).toBe(401)
  expect((await agent.get('/api/forms-config')).status()).toBe(401)

  // a cross-origin write is refused before any of that is even considered
  const xo = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { origin: 'https://evil.example' },
  })
  // (no session on this context, but the origin check runs first)
  expect([403]).toContain((await xo.post('/api/integrations', { data: { name: 'X' } })).status())

  await admin.delete(`/api/integrations/${id}`)
  for (const ctx of [admin, editor, contributor, agent, xo]) await ctx.dispose()
})

test('a capability pick is refused by name when a key is missing', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const created = await admin.post('/api/integrations', { data: { name: 'Mailer' } })
  const { id } = await created.json()
  await admin.put(`/api/integrations/${id}/keys/HOST`, { data: { value: 'smtp.example.com', secret: false } })

  // the server does not know which integration "is SMTP" — it checks the pick
  // carries the keys, and says which are missing rather than "not configured"
  const partial = await admin.put('/api/forms-config', { data: { mailer: id } })
  expect(partial.status()).toBe(400)
  const reason = (await partial.json()).error
  expect(reason).toContain('Mailer')
  expect(reason).toMatch(/PORT/)

  for (const [k, v] of [
    ['PORT', '587'],
    ['USER', 'u'],
    ['PASSWORD', 'p'],
    ['FROM', 'site@example.com'],
  ]) {
    await admin.put(`/api/integrations/${id}/keys/${k}`, { data: { value: v, secret: k === 'PASSWORD' } })
  }
  const full = await admin.put('/api/forms-config', {
    data: { mailer: id, notifyTo: ['leads@example.com'] },
  })
  expect(full.ok()).toBeTruthy()

  // a bad port is refused with the allowed set, not silently stored
  await admin.put(`/api/integrations/${id}/keys/PORT`, { data: { value: '9999', secret: false } })
  const badPort = await admin.put('/api/forms-config', { data: { mailer: id } })
  expect(badPort.status()).toBe(400)
  expect((await badPort.json()).error).toContain('587')

  // a WEBHOOK pointed at the operator's own network is refused at pick time,
  // not weeks later in a delivery log
  const hook = await admin.post('/api/integrations', { data: { name: 'Hook' } })
  const hookId = (await hook.json()).id
  await admin.put(`/api/integrations/${hookId}/keys/FORWARD_URL`, {
    data: { value: 'https://127.0.0.1/hook', secret: false },
  })
  const ssrf = await admin.put('/api/forms-config', { data: { webhook: hookId } })
  expect(ssrf.status()).toBe(400)
  expect((await ssrf.json()).error).toMatch(/private address|public host/)

  await admin.put(`/api/integrations/${hookId}/keys/FORWARD_URL`, {
    data: { value: 'http://example.com/hook', secret: false },
  })
  const plain = await admin.put('/api/forms-config', { data: { webhook: hookId } })
  expect(plain.status()).toBe(400)
  expect((await plain.json()).error).toContain('https')

  // recipients are validated, and capped
  const badEmail = await admin.put('/api/forms-config', { data: { notifyTo: ['nope'] } })
  expect(badEmail.status()).toBe(400)
  const tooMany = await admin.put('/api/forms-config', {
    data: { notifyTo: ['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co', 'i@j.co', 'k@l.co'] },
  })
  expect(tooMany.status()).toBe(400)

  await admin.put('/api/forms-config', { data: { mailer: '', webhook: '', notifyTo: [] } })
  await admin.delete(`/api/integrations/${id}`)
  await admin.delete(`/api/integrations/${hookId}`)
  await admin.dispose()
})
