import { expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test'
import { loadFixture } from './project'

/**
 * How a UI spec gets into the editor.
 *
 * ONE copy of this. There were thirteen — every `ui-*.spec.ts` carried its own
 * `openEditor`, each logging in through the browser form, and all thirteen
 * became CONTRIBUTOR sessions the moment the server's build gates started
 * reading `effectiveRole(req, user)` instead of `user.role`: a browser session
 * is never a builder session. Consolidating first, while `user.role` still
 * decided, and running the suite green, turned one big uncertain commit into
 * two small ones — and a spec that builds pages now says so by which helper it
 * calls.
 *
 * `openEditor` is a BUILDER session, minted the way the desktop launcher mints
 * one. `openEditorInBrowser` is the form login, for the specs where the browser
 * itself is the point.
 */

export const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
export const PROJECT_NAME = 'Smoke Co'

/**
 * The suite server's spawn secret, imported by `playwright.config.ts` into
 * `webServer.env` so there is exactly one definition of it. It is not a secret
 * in any meaningful sense — the route it unlocks is loopback-only and the
 * server it unlocks is a throwaway on port 4188 — but it must be ≥32 chars or
 * the server refuses to expose the route at all.
 */
export const LAUNCHER_SECRET = 'e2e-launcher-secret-0123456789abcdef'

/**
 * Upgrade an API context's session to the kind the desktop launcher holds.
 *
 * **A browser session is never a builder session** (`effectiveRole` in
 * server/auth.mjs): a cookie session is capped at contributor whatever its
 * account's role, because the Build surface lives in the desktop app. So an
 * API spec that sets up a project, writes structure, reads the team, mints a
 * token, publishes, snapshots or touches settings has to hold THIS kind of
 * session — a password login would be a contributor doing builder work, which
 * is exactly what the server now refuses.
 *
 * The secret proof, over the suite server's loopback, which mints for the
 * instance's owner (`oldestAdmin()`). A spec that needs a builder session for
 * someone ELSE — a second builder, an editor with their own Mac — needs the
 * bearer proof instead: a `superbirdl_` token that account approved for itself
 * through the device flow (see `store-agent-security.spec.ts`).
 */
export async function becomeBuilder(ctx: APIRequestContext) {
  const res = await ctx.post('/api/auth/launcher-session', { data: { secret: LAUNCHER_SECRET } })
  expect(res.status(), 'the suite server must carry SUPERBIRD_LAUNCHER_SECRET').toBe(200)
  return ctx
}

/**
 * A builder session for someone who is NOT the instance's owner — a second
 * builder, an editor with their own Mac.
 *
 * The secret proof mints for `oldestAdmin()` alone, so this is the only way:
 * a `superbirdl_` launcher token that this account approved **for itself** through
 * the device flow. That is the whole path a second builder takes in real life,
 * which is why a LAUNCHER authorization needs a build role rather than an
 * admin — the token carries exactly the approver's own role, so admin-only was
 * a dead end and not a safeguard.
 *
 * `who` must already hold that account's browser session; the returned context
 * is a new one holding the builder session, and `who` is left alone.
 *
 * The device pool is capped per ADDRESS as well as rate-limited per address,
 * and every context in the suite otherwise shares one socket — so each flow
 * presents its own `X-Forwarded-For`, which `TRUST_PROXY` is on for (→
 * playwright.config.ts).
 */
let deviceClients = 0
export async function becomeBuilderByApproval(
  who: APIRequestContext,
  baseURL: string | undefined,
  name: string,
) {
  deviceClients += 1
  const anon = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': `10.8.0.${deviceClients}` },
  })
  const begun = await anon.post('/api/auth/device', { data: { name, kind: 'launcher' } })
  expect(begun.ok(), await begun.text()).toBeTruthy()
  const { userCode, deviceCode } = await begun.json()
  const approved = await who.post(`/api/auth/device/${userCode}/approve`, { data: {} })
  expect(approved.ok(), await approved.text()).toBeTruthy()
  const got = await anon.post('/api/auth/device/token', { data: { deviceCode } })
  expect(got.ok(), await got.text()).toBeTruthy()
  const { token } = await got.json()
  await anon.dispose()
  expect(String(token).startsWith('superbirdl_')).toBeTruthy()

  const builder = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  })
  const minted = await builder.post('/api/auth/launcher-session', { data: {} })
  expect(minted.status(), await minted.text()).toBe(200)
  return builder
}

/** the editor is up and interactive */
const ready = (page: Page) => page.getByRole('button', { name: 'Pages', exact: true })

/**
 * Mint a builder session on this page's context, creating the admin account
 * first if the data dir is fresh.
 *
 * `page.request` shares the context's cookie jar, so the cookie the route sets
 * is the one the page then navigates with. Setup goes over the API rather than
 * the form because loopback needs no setup code — the same reason the launcher
 * posts it locally.
 */
export async function launcherSession(page: Page) {
  const mint = () => page.request.post('/api/auth/launcher-session', { data: { secret: LAUNCHER_SECRET } })
  let res = await mint()
  if (res.status() === 404) {
    throw new Error(
      'the suite server has no SUPERBIRD_LAUNCHER_SECRET — playwright.config.ts must pass LAUNCHER_SECRET in webServer.env',
    )
  }
  if (res.status() === 409) {
    const setup = await page.request.post('/api/auth/setup', {
      data: { ...ADMIN, projectName: PROJECT_NAME },
    })
    if (!setup.ok()) throw new Error(`could not create the admin account (${setup.status()})`)
    res = await mint()
  }
  if (!res.ok()) throw new Error(`could not mint a launcher session (${res.status()})`)
}

/**
 * Seed the fixture project and wait until the editor is interactive. Shared, so
 * the two entry points below differ in ONE thing — the kind of session — and a
 * spec can be moved between them by changing which one it calls.
 *
 * `canvas: true` also waits for the fixture's content to be rendered, which the
 * specs that click elements on the canvas need and the ones that only open a
 * panel do not.
 */
async function enterEditor(page: Page, { canvas = false } = {}) {
  await loadFixture(page)
  await expect(ready(page)).toBeVisible({ timeout: 30_000 })
  if (canvas) {
    await expect(page.getByText('Tuesday is roast day.').first()).toBeVisible({ timeout: 30_000 })
  }
}

/** Into the editor, on the fixture project, as a BUILDER. The default. */
export async function openEditor(page: Page, opts: { canvas?: boolean } = {}) {
  await launcherSession(page)
  await enterEditor(page, opts)
}

/**
 * Into the editor through the login form, as a BROWSER session.
 *
 * For the specs where the browser IS the point — the chrome the desktop app
 * hides and draws itself (the App button, the save pill, the account menu),
 * what a browser-signed-in account may do, and that it is pinned to Play
 * whatever its role. Everything else should use `openEditor`: a UI spec is not
 * a test of the login form.
 */
export async function openEditorInBrowser(
  page: Page,
  { canvas = false, who = ADMIN }: { canvas?: boolean; who?: typeof ADMIN } = {},
) {
  // Seeding the fixture is a STRUCTURAL write, so it is done by a builder:
  // a browser session's project write is content-merged, and the fixture's
  // custom code is refused by name. Account first, then the seed, then sign
  // out and in through the form — which is the thing this helper is for.
  await launcherSession(page)
  await loadFixture(page)
  await page.request.post('/api/auth/logout')

  await page.goto('/admin/login')
  const email = page.getByPlaceholder('Email')
  await expect(email).toBeVisible({ timeout: 30_000 })
  await email.fill(who.email)
  await page.getByPlaceholder('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
  await expect(ready(page)).toBeVisible({ timeout: 30_000 })
  if (canvas) {
    await expect(page.getByText('Tuesday is roast day.').first()).toBeVisible({ timeout: 30_000 })
  }
}
