import { expect, type Page } from '@playwright/test'
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
      'the suite server has no GUANO_LAUNCHER_SECRET — playwright.config.ts must pass LAUNCHER_SECRET in webServer.env',
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
  await page.goto('/admin/')
  const projectName = page.getByPlaceholder('Project name')
  const email = page.getByPlaceholder('Email')
  await expect(projectName.or(email).or(ready(page)).first()).toBeVisible({ timeout: 30_000 })

  if (await projectName.isVisible()) {
    await projectName.fill(PROJECT_NAME)
    await email.fill(who.email)
    await page.getByPlaceholder('Project password (min. 8 characters)').fill(who.password)
    await page.getByPlaceholder('Confirm project password').fill(who.password)
    await page.getByRole('button', { name: 'Setup project' }).click()
  } else if (await email.isVisible()) {
    await email.fill(who.email)
    await page.getByPlaceholder('Password', { exact: true }).fill(who.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
  await enterEditor(page, { canvas })
}
