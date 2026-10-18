import { test, expect, request as pwRequest } from '@playwright/test'
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
    env: { GUANO_LAUNCHER_SECRET: SECRET },
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
    env: { GUANO_LAUNCHER_SECRET: SECRET },
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
    env: { GUANO_LAUNCHER_SECRET: SECRET },
  })
  await srv.api.post('/api/auth/setup', {
    data: { email: EMAIL, password: PASSWORD, projectName: 'Launcher UI' },
  })

  const ctx = await bare(srv.port)
  const minted = await ctx.post('/api/auth/launcher-session', { data: { secret: SECRET } })
  const cookie = minted.headers()['set-cookie'].split(';')[0]
  const [name, value] = [cookie.slice(0, cookie.indexOf('=')), cookie.slice(cookie.indexOf('=') + 1)]

  const hidden = ['App', 'My account', 'Logout']

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
  await launcher.close()

  const plain = await browser.newContext()
  const page2 = await plain.newPage()
  await page2.goto(`http://localhost:${srv.port}/admin/login`)
  await page2.fill('input[type="email"]', EMAIL)
  await page2.fill('input[type="password"]', PASSWORD)
  await page2.getByRole('button', { name: 'Sign in' }).click()
  await expect(page2.locator('[aria-label="Pages"]')).toBeVisible()
  for (const label of hidden) {
    await expect(page2.locator(`[aria-label="${label}"]`)).toBeVisible()
  }
  await expect(page2.locator('aside [aria-live="polite"]')).toBeVisible()
  await plain.close()
})
