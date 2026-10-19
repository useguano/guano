import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { boot, instances } from './fixtures/server'

// The session the desktop launcher mints for itself.
//
// The launcher spawns the server and holds its data dir, which is the same
// ownership `/api/auth/connect` already trusts — so it may mint a session for
// the instance's owner without a password, over loopback, with a secret passed
// in the env at spawn. Everything else must be untouched: a browser reaching
// the same server (over the LAN, or just in another window) still logs in and
// still gets the full chrome.
//
// A server of its own, because the secret is read from the process env.

const SECRET = randomBytes(32).toString('hex')
const EMAIL = 'owner@example.com'
const PASSWORD = 'launcher-pw-123'

/** a context with no cookies — the mint must not depend on one */
const bare = (port: number) => pwRequest.newContext({ baseURL: `http://localhost:${port}` })

test.afterEach(() => {
  for (const i of instances) i.stop()
  instances.length = 0
})

test('the launcher mints a session, and only over loopback with the right secret', async () => {
  const srv = await boot('launcher-session', 4405, {
    env: { SUPERBIRD_LAUNCHER_SECRET: SECRET },
  })

  // before setup there is nobody to mint for — 409, not an error, because the
  // launcher's answer is to show the webview and let setup happen
  const early = await srv.api.post('/api/auth/launcher-session', { data: { secret: SECRET } })
  expect(early.status()).toBe(409)
  expect((await early.json()).needsSetup).toBe(true)

  await srv.api.post('/api/auth/setup', {
    data: { email: EMAIL, password: PASSWORD, projectName: 'Launcher' },
  })

  // a wrong secret is refused by name
  const wrong = await srv.api.post('/api/auth/launcher-session', {
    data: { secret: randomBytes(32).toString('hex') },
  })
  expect(wrong.status()).toBe(403)
  expect((await wrong.json()).error).toContain('secret')

  // the real thing: a cookie, for the owner, with no password anywhere
  const ctx = await bare(srv.port)
  const minted = await ctx.post('/api/auth/launcher-session', { data: { secret: SECRET } })
  expect(minted.status()).toBe(200)
  expect((await minted.json()).email).toBe(EMAIL)

  // and it reports itself as a launcher session
  const me = await ctx.get('/api/auth/me')
  expect(me.status()).toBe(200)
  expect((await me.json()).host).toBe('launcher')

  // a password login against the SAME server is a browser session
  const browser = await bare(srv.port)
  await browser.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })
  expect((await (await browser.get('/api/auth/me')).json()).host).toBe('browser')
})

test('the launcher tag survives a password change', async () => {
  const srv = await boot('launcher-session-pw', 4406, {
    env: { SUPERBIRD_LAUNCHER_SECRET: SECRET },
  })
  await srv.api.post('/api/auth/setup', {
    data: { email: EMAIL, password: PASSWORD, projectName: 'Launcher' },
  })

  const ctx = await bare(srv.port)
  await ctx.post('/api/auth/launcher-session', { data: { secret: SECRET } })

  // a password change revokes every session and re-issues one for the caller;
  // that replacement must still be a launcher session, or the desktop window
  // silently grows back the chrome it is meant to hide
  const changed = await ctx.post('/api/auth/update', {
    data: { password: 'a-different-pw-456', currentPassword: PASSWORD },
  })
  expect(changed.status()).toBe(200)
  expect((await (await ctx.get('/api/auth/me')).json()).host).toBe('launcher')
})

// ---------- the second proof: a `superbirdl_` launcher token ----------
//
// A VPS is not spawned by the app, so there is no secret and no loopback to
// prove with. The remote stand-in is a launcher token, approved once in the
// instance's own /admin through the device flow — and it has to mint the one
// same kind of session, because the rest of the server only knows about
// `via: 'launcher'`.

/** drive the device flow to completion and return the raw token it mints */
async function deviceToken(
  srv: { port: number; api: APIRequestContext },
  admin: APIRequestContext,
  kind: 'agent' | 'launcher',
) {
  const started = await srv.api.post('/api/auth/device', { data: { name: `test ${kind}`, kind } })
  expect(started.ok()).toBeTruthy()
  const { userCode, deviceCode } = await started.json()

  // the consent screen is told which sentence it is showing
  const described = await admin.get(`/api/auth/device/${userCode}`)
  expect(described.ok()).toBeTruthy()
  expect((await described.json()).kind).toBe(kind)

  expect((await admin.post(`/api/auth/device/${userCode}/approve`, { data: {} })).ok()).toBeTruthy()
  const collected = await srv.api.post('/api/auth/device/token', { data: { deviceCode } })
  expect(collected.ok()).toBeTruthy()
  const { token } = await collected.json()
  expect(typeof token).toBe('string')
  return token as string
}

test('a launcher token is exchanged for a launcher session; an agent token is refused by name', async () => {
  const srv = await boot('launcher-session-token', 4409)
  await srv.api.post('/api/auth/setup', {
    data: { email: EMAIL, password: PASSWORD, projectName: 'Remote' },
  })
  const admin = await bare(srv.port)
  expect((await admin.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })).ok()).toBeTruthy()

  // No SUPERBIRD_LAUNCHER_SECRET on this server at all: the bearer proof stands on
  // its own, and the route must exist for it even with the env absent.
  const launcherToken = await deviceToken(srv, admin, 'launcher')
  expect(launcherToken.startsWith('superbirdl_')).toBeTruthy()

  const ctx = await pwRequest.newContext({
    baseURL: `http://localhost:${srv.port}`,
    extraHTTPHeaders: { authorization: `Bearer ${launcherToken}` },
  })
  const minted = await ctx.post('/api/auth/launcher-session', { data: {} })
  expect(minted.status()).toBe(200)
  expect((await minted.json()).email).toBe(EMAIL)
  // the session it mints is indistinguishable from the one the secret mints
  expect((await (await ctx.get('/api/auth/me')).json()).host).toBe('launcher')

  // an AGENT token at this door is 403 BY NAME — the trap of the whole design:
  // if it were accepted, an injected agent would trade its token for a cookie
  // and stop being an agent in the server's eyes
  const agentToken = await deviceToken(srv, admin, 'agent')
  expect(agentToken.startsWith('superbird_')).toBeTruthy()
  expect(agentToken.startsWith('superbirdl_')).toBeFalsy()
  const agent = await pwRequest.newContext({
    baseURL: `http://localhost:${srv.port}`,
    extraHTTPHeaders: { authorization: `Bearer ${agentToken}` },
  })
  const refused = await agent.post('/api/auth/launcher-session', { data: {} })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error).toBe('an agent token cannot open the editor')

  // The token list is builder-only, so it is read with the session the token
  // just bought and not with the browser login above: a browser session is
  // never a builder session, whatever the account.
  const listed = await ctx.get('/api/tokens')
  expect(listed.ok(), await listed.text()).toBeTruthy()
  const row = (await listed.json()).tokens.find((t: { kind: string }) => t.kind === 'launcher')
  expect(row).toBeTruthy()

  // and a revoked launcher token stops working, which is what makes
  // Reconnect-rather-than-login the right answer in the app
  expect((await ctx.delete(`/api/tokens/${row.id}`)).ok()).toBeTruthy()
  const dead = await ctx.post('/api/auth/launcher-session', { data: {} })
  expect(dead.status()).toBe(403)
  expect((await dead.json()).error).toContain('revoked')
})

test('a launcher token whose owner cannot build is refused', async () => {
  const srv = await boot('launcher-session-role', 4410)
  await srv.api.post('/api/auth/setup', {
    data: { email: EMAIL, password: PASSWORD, projectName: 'Remote role' },
  })
  const admin = await bare(srv.port)
  await admin.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })

  const token = await deviceToken(srv, admin, 'launcher')
  const ctx = await pwRequest.newContext({
    baseURL: `http://localhost:${srv.port}`,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  })
  expect((await ctx.post('/api/auth/launcher-session', { data: {} })).status()).toBe(200)

  // A second admin, so the first can be demoted (adminCount guards the last
  // one). Invited through the session the launcher token bought — inviting is
  // builder-only, and the browser login above is a contributor at the API.
  const invite = await ctx.post('/api/users/invite', {
    data: { name: 'Second', email: 'second@example.com', role: 'admin' },
  })
  expect(invite.ok(), await invite.text()).toBeTruthy()
  const second = await bare(srv.port)
  await second.post(`/api/invite/${(await invite.json()).token}/accept`, {
    data: { password: 'second-admin-pw-1' },
  })
  // ...and that second admin needs a builder session of their own to demote
  // anyone: the same device flow, approved by themselves.
  const secondToken = await deviceToken(srv, second, 'launcher')
  const secondBuilder = await pwRequest.newContext({
    baseURL: `http://localhost:${srv.port}`,
    extraHTTPHeaders: { authorization: `Bearer ${secondToken}` },
  })
  expect((await secondBuilder.post('/api/auth/launcher-session', { data: {} })).status()).toBe(200)

  const owner = (await (await secondBuilder.get('/api/users')).json()).users.find(
    (u: { email: string }) => u.email === EMAIL,
  )
  expect(
    (await secondBuilder.patch(`/api/users/${owner.id}`, { data: { role: 'contributor' } })).ok(),
  ).toBeTruthy()

  // the role is read LIVE on every exchange, which is why the app re-exchanges
  // rather than holding one session for thirty days
  const refused = await ctx.post('/api/auth/launcher-session', { data: {} })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error).toContain('cannot build')
})

test('without the env the route does not exist', async () => {
  const srv = await boot('launcher-session-off', 4407)
  await srv.api.post('/api/auth/setup', {
    data: { email: EMAIL, password: PASSWORD, projectName: 'Plain' },
  })
  const res = await srv.api.post('/api/auth/launcher-session', { data: { secret: SECRET } })
  expect(res.status()).toBe(404)
})

test('a launcher session hides the chrome the app provides; a browser session keeps it', async ({
  browser,
}) => {
  const srv = await boot('launcher-session-ui', 4408, {
    env: { SUPERBIRD_LAUNCHER_SECRET: SECRET },
  })
  await srv.api.post('/api/auth/setup', {
    data: { email: EMAIL, password: PASSWORD, projectName: 'Launcher UI' },
  })

  const ctx = await bare(srv.port)
  const minted = await ctx.post('/api/auth/launcher-session', { data: { secret: SECRET } })
  const cookie = minted.headers()['set-cookie'].split(';')[0]
  const [name, value] = [cookie.slice(0, cookie.indexOf('=')), cookie.slice(cookie.indexOf('=') + 1)]

  // What the desktop app's own window provides, and the editor therefore does
  // not draw under it: the account menu, Logout, and the save pill that is
  // also the Publish entry.
  //
  // The App button is NOT in this list. It is the editor's own control — it
  // clears the columns and puts the page canvas back, which is the only way
  // off the component board — and the app provides no replacement. It used to
  // be hidden here too, and once a browser session stopped being able to
  // build, `canBuild` and `showsAppHome` became mutually exclusive and the
  // button could render for nobody.
  const hidden = ['My account', 'Logout']

  const launcher = await browser.newContext()
  await launcher.addCookies([
    { name, value, domain: 'localhost', path: '/', httpOnly: true, secure: false },
  ])
  const page = await launcher.newPage()
  await page.goto(`http://localhost:${srv.port}/admin/`)
  await expect(page.locator('[aria-label="Pages"]')).toBeVisible()
  for (const label of hidden) {
    await expect(page.locator(`[aria-label="${label}"]`)).toHaveCount(0)
  }
  // the right rail's save-status button, which is also the publish entry
  await expect(page.locator('aside [aria-live="polite"]')).toHaveCount(0)
  // project settings is NOT hidden — it is the project's, not the person's
  await expect(page.locator('[aria-label="Project settings"]')).toBeVisible()
  // ...and neither is the App button, which is the only way back to the page
  // canvas from the component board
  await expect(page.locator('[aria-label="App"]')).toBeVisible()
  await launcher.close()

  // The same account in a browser keeps the chrome the app replaces — and is
  // CONTENT-ONLY, because a browser session is never a builder session. So the
  // account controls and the save pill are there, and the build surface is not:
  // `canBuild` comes off `/api/auth/me`, and `useViewMode` pins a non-builder
  // to Play. The App button and the Components rail are inside `canBuild`.
  const plain = await browser.newContext()
  const page2 = await plain.newPage()
  await page2.goto(`http://localhost:${srv.port}/admin/login`)
  await page2.fill('input[type="email"]', EMAIL)
  await page2.fill('input[type="password"]', PASSWORD)
  await page2.getByRole('button', { name: 'Sign in' }).click()
  await expect(page2.locator('[aria-label="Pages"]')).toBeVisible()
  for (const label of ['My account', 'Logout']) {
    await expect(page2.locator(`[aria-label="${label}"]`)).toBeVisible()
  }
  await expect(page2.locator('aside [aria-live="polite"]')).toBeVisible()
  // pinned to Play, so nothing that builds is offered
  await expect(page2.locator('[aria-label="Components"]')).toHaveCount(0)
  await expect(page2.locator('[aria-label="App"]')).toHaveCount(0)
  await plain.close()
})
