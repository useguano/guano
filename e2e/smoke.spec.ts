import { test, expect } from '@playwright/test'
import { loadFixture } from './fixtures/project'
import { fakeHost, hostViewMode } from './fixtures/host'
import { launcherSession } from './fixtures/session'

// End-to-end smoke: first-run setup → load the demo project → edit a text
// node on the Edit canvas → see it in Play → publish → assert the edit on the
// published route → assert the admin route redirects to login when logged out.
// Runs against an isolated server (see playwright.config.ts). Not a suite —
// one happy path plus the auth guard.

test('setup, edit content, publish, view live, auth guard', async ({ page, context }) => {
  const marker = `SMOKE-${Date.now()}`
  // the Edit / Play switch is the launcher's, reached over the host bridge
  await fakeHost(page)

  // 1. fresh server has no admin → /admin redirects to first-run setup
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/setup/)

  // 2. create the first admin (this logs us in and hard-redirects to /admin)
  await page.getByPlaceholder('Project name').fill('Smoke Co')
  await page.getByPlaceholder('Email').fill('smoke@example.com')
  await page.getByPlaceholder('Project password (min. 8 characters)').fill('supersecret1')
  await page.getByPlaceholder('Confirm project password').fill('supersecret1')
  // the form asks the two agent questions (Main writes, publish); both are
  // off by default and the rest of the suite relies on the all-off policy,
  // so assert they are present and leave them alone
  await expect(page.getByRole('switch', { name: 'Let agents edit the live project (Main)' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await expect(page.getByRole('switch', { name: 'Let agents publish the site' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.getByRole('button', { name: 'Setup project' }).click()
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })

  // 2b. ...and the launcher mints its session, which is what makes this a
  //     BUILDER. `AppModel.completeSetup` does exactly this: it posts setup
  //     over loopback and mints the moment the server answers. Without it the
  //     form's own cookie is an ordinary browser session, which the server
  //     caps at contributor — so everything below, from the fixture's
  //     structural write to the publish, would be refused or merged away.
  await launcherSession(page)

  // 3. load the demo project (the only content fixture) — resets the project
  //    in memory to the published "Brume" coffee site
  await loadFixture(page)

  // 4. edit the home page's hero heading on the Edit canvas — the only surface
  //    that edits content in place. The shell opens there, so there is nothing
  //    to switch. The canvas draws one frame per breakpoint, hence `.first()`.
  const hero = page.locator('h1', { hasText: 'Coffee roasted' }).first()
  await expect(hero).toBeVisible({ timeout: 30_000 })
  // dispatch the dblclick directly: a decorative hero layer sits over the h1
  // and would intercept a real pointer dblclick. This fires the same Vue
  // handler, which mounts a focused contenteditable span with all text selected.
  await hero.dispatchEvent('dblclick')
  const editSpan = page.locator('span[contenteditable]')
  await expect(editSpan).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(marker)
  await page.keyboard.press('Enter') // Enter commits; Escape discards
  await expect(page.locator('h1', { hasText: marker }).first()).toBeVisible()

  // 4b. Play renders the edited site. Play (the Preview surface internally) is
  //     a MODE inside the one editor shell, not a route — so the assertion
  //     is that the site renders, not the URL. The switch is the HOST's
  //     Preview / Editor button, over the bridge — the editor draws none of
  //     its own. It is read-only: what it shows is what publish will emit.
  await hostViewMode(page, 'preview')
  await expect(page.locator('h1', { hasText: marker }).first()).toBeVisible({ timeout: 30_000 })

  // 5. publish — ⌘P opens PublishDialog, which auto-runs the publish on open.
  //    (The header Publish button is gone; the rail's save-status button opens
  //    a popover with its own Publish, and the shortcut is the stable handle.)
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 30_000 })

  // 6. the published static route carries the edited text
  await page.goto('/')
  await expect(page.locator('body')).toContainText(marker)

  // 7. logged out, the admin route redirects to login (a user now exists)
  await context.clearCookies()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/login/, { timeout: 30_000 })
})
