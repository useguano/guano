import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// Editing a collection item's FIELD VALUES in the Pages drawer.
//
// Before this, entry data could only be typed into the template page on the
// canvas "in entry context" — which assumes the collection has a page design
// worth rendering through. Clicking an entry now opens an in-drawer editor
// instead, and crucially does NOT close the drawer.
//
// Assertions land on the published export rather than the panel's DOM (the
// house style), so this keeps its value through a reskin. The one exception is
// step 1: "the drawer stayed open" IS the regression under test.
//
// Named to sort AFTER smoke.spec: smoke owns the first-run flow and needs a
// server with no admin account yet, so any spec that logs in has to run later
// (same reason ui-slider-panel and store-agent-security carry their names).

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

/** the demo's first journal entry — has `fr` overrides on title/excerpt/body */
const ENTRY = 'Why we rest our roasts for three days'
const ENTRY_PATH = '/post/why-we-rest-our-roasts-for-three-days'

/** log in (or do first-run setup) and load the demo project */
async function openEditor(page: Page) {
  await page.goto('/admin/')
  const projectName = page.getByPlaceholder('Project name')
  const email = page.getByPlaceholder('Email')
  const ready = page.getByRole('button', { name: 'Pages', exact: true })
  await expect(projectName.or(email).or(ready).first()).toBeVisible({ timeout: 30_000 })

  if (await projectName.isVisible()) {
    await projectName.fill('Smoke Co')
    await email.fill(ADMIN.email)
    await page.getByPlaceholder('Password (min. 8 characters)').fill(ADMIN.password)
    await page.getByPlaceholder('Confirm password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Setup project' }).click()
  } else if (await email.isVisible()) {
    await email.fill(ADMIN.email)
    await page.getByPlaceholder('Password', { exact: true }).fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
  await loadFixture(page)
  await expect(ready).toBeVisible({ timeout: 30_000 })
}

/**
 * Publish, waiting out the server's rate limit if the suite has hit it.
 *
 * A publish is a full Tailwind compile plus a static export, so the server
 * allows 12 a minute per user — plenty for a person, and less than a suite
 * that publishes in a dozen specs back to back. The limit is a real guard
 * against a runaway loop, so the test waits rather than the product relaxing.
 */
async function publish(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('ControlOrMeta+p')
    const done = page.getByText('Published!')
    const failed = page.getByText('Publish failed')
    await expect(done.or(failed).first()).toBeVisible({ timeout: 60_000 })
    if (await done.isVisible()) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(20_000) // the window is 60s; three tries covers it
  }
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 60_000 })
}

/** open the Pages drawer and click into the demo entry's editor */
async function openEntryEditor(page: Page) {
  await page.getByRole('button', { name: 'Pages' }).click()
  await page.getByRole('button', { name: 'post', exact: false }).first().click() // expand
  await page.getByRole('button', { name: ENTRY }).click()
}

/** the rich-text box for one field, found by its label inside the Content group */
function fieldBox(page: Page, name: string) {
  return page
    .locator('div', { has: page.locator(`> div > span:text-is("${name}")`) })
    .locator('[contenteditable]')
    .first()
}

test('the drawer edits an item’s field values, and they reach the published site', async ({
  page,
}) => {
  await openEditor(page)
  await openEntryEditor(page)

  // 1. the regression this whole view exists to prevent: clicking an entry used
  //    to navigate and CLOSE the drawer, which left data-only collections with
  //    nowhere to edit their data at all.
  await expect(page.getByText('Edit item')).toBeVisible()
  await expect(page.getByText('Content', { exact: true })).toBeVisible()

  // 2. a value typed here survives to the export
  const title = fieldBox(page, 'title')
  await title.click()
  await title.fill('Resting roasts, revisited')
  await title.blur()

  await publish(page)
  await page.goto(ENTRY_PATH)
  await expect(page.locator('h1')).toContainText('Resting roasts, revisited')
})

test('translating an item: overrides show, and clearing one restores the fallback', async ({
  page,
}) => {
  await openEditor(page)
  await openEntryEditor(page)

  // the locale switcher stays pinned in the item editor (it is deliberately
  // outside the tree branch) — without it a translator would be stranded
  await page.getByText('English').click()
  await page.getByRole('button', { name: /Français|French/ }).first().click()

  const title = fieldBox(page, 'title')
  await expect(title).toContainText('Pourquoi nous laissons reposer')

  // clearing an override prunes it, so the field falls back to the base value
  await title.click()
  await title.fill('')
  await title.blur()

  await publish(page)
  await page.goto(`/fr${ENTRY_PATH}`)
  await expect(page.locator('h1')).toContainText('Why we rest our roasts')
})
