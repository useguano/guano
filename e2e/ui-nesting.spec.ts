import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// Nesting — a component that holds another.
//
// A Testimonial is given a Button on the board; every one on the page follows.
// (The library's own Card already holds a Button — this is the same thing,
// done by hand.) Then
// the two things nesting is FOR: each host says its own thing in its button,
// and restyling Button once restyles the button in every host — because what
// is inside a nested instance still belongs to the component it is an
// instance of.
//
// Named to sort AFTER smoke.spec (it logs in).

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

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
  // wait for the fixture's content to actually be on the canvas
  await expect(page.getByText('Tuesday is roast day.').first()).toBeVisible({ timeout: 30_000 })
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

const rail = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const rows = (page: Page) => page.locator('[data-layer-row]')

/** a page's layers open from its Edit icon in the Pages drawer */
async function openLayers(page: Page, name = 'Home') {
  const row = page.locator(`[data-page-row="${name}"]`)
  // Get to the page LIST, whatever the column is showing — closed, another
  // drawer, or parked in a detail view. Re-probed each time round, because a
  // rail click settles on the next render flush: reading the DOM straight
  // after one can see the view that is on its way out and act on it.
  for (let attempt = 0; attempt < 4 && !(await row.isVisible()); attempt++) {
    // `exact` matters: the name match is a substring, and the Style panel's
    // 'Background' section header is a button too
    const back = page.getByRole('button', { name: 'Back', exact: true })
    if (await back.isVisible()) await back.click()
    else await rail(page, 'Pages').click()
    await page.waitForTimeout(150)
  }
  await row.hover()
  await row.getByRole('button', { name: 'Edit layers' }).click()
  await expect(rows(page).first()).toBeVisible({ timeout: 15_000 })
}

const componentRow = (page: Page, name: string) => page.locator(`[data-component="${name}"]`)

/** insert one element from the ⌘E dock at the current selection */
/** Escape, then wait for the dock to actually be gone.
 *
 * It closes on the next render flush, and the next action can outrun it —
 * leaving the dock's own 'Components' tab matching the rail button of the same
 * name, which reads as a strict-mode violation rather than as a race. */
async function closeDock(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-dock-tab]').first()).toBeHidden()
}

async function insertFromDock(page: Page, key: string) {
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator(`[data-dock-item="${key}"]`).click()
  await closeDock(page)
}

/** insert one of the project's components on the page from the ⌘E dock */
async function insertComponent(page: Page, name: string) {
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator('[data-dock-item^="component:"]', { hasText: new RegExp(`^${name}$`) }).first().click()
  await closeDock(page)
}


/** type into an element on the canvas, the way a person does: double-click it */
async function retype(page: Page, rowId: string, text: string) {
  const el = page.locator(`[data-node-id="${rowId}"]`).first()
  await el.dispatchEvent('dblclick')
  const editing = page.locator('span[contenteditable]')
  await expect(editing).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('a component is given a Button: each instance says its own, and Button is styled once', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // two of them on the page
  await rows(page).first().click()
  await insertComponent(page, 'Testimonial')
  await rows(page).first().click()
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator('[data-dock-item^="component:"]', { hasText: /^Testimonial$/ }).first().click()
  await closeDock(page)
  const wrappers = (name: string) => rows(page).filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) })
  await expect(wrappers('Testimonial')).toHaveCount(2)
  await expect(wrappers('Button')).toHaveCount(0)

  // --- on the board, the component gets a Button. It comes from the library, so
  // this is also what adds Button to the project.
  await rail(page, 'Components').click()
  await componentRow(page, 'Testimonial').locator('[data-row-toggle]').click()
  await rows(page).first().click() // the testimonial's own box
  await insertComponent(page, 'Button')
  await expect(componentRow(page, 'Button')).toBeVisible()
  // a component never offers to go inside itself, or inside what it holds
  await componentRow(page, 'Button').locator('[data-row-toggle]').click()
  await componentRow(page, 'Button').locator('..').locator('[data-layer-row]').first().click()
  await page.keyboard.press('ControlOrMeta+e')
  await expect(page.locator('[data-dock-item^="component:"]', { hasText: /^Testimonial$/ })).toHaveCount(0)
  await expect(page.locator('[data-dock-item^="component:"]', { hasText: /^Button$/ })).toHaveCount(0)
  await closeDock(page)

  // --- both instances on the page followed
  await rail(page, 'App').click()
  await openLayers(page)
  await expect(wrappers('Button')).toHaveCount(2)

  // --- each says its own: the words of the FIRST one's button
  const firstButton = wrappers('Button').first()
  // after the wrapper: the <button>, its leading icon (hidden, so it has a row
  // and no element), then the span holding the words
  const spanRow = firstButton.locator('xpath=following::*[@data-layer-row][3]')
  const spanId = (await spanRow.getAttribute('data-layer-row'))!
  await retype(page, spanId, 'Read more')

  // --- Button is restyled ONCE, in its own card
  await rail(page, 'Components').click()
  // (its row is still open from before: the drawer remembers)
  await componentRow(page, 'Button').locator('..').locator('[data-layer-row]').first().click()
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await page.getByPlaceholder('Add class').fill('rounded-full')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  await rail(page, 'App').click()
  await publish(page)
  const html = await (await page.request.get('/')).text()
  const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*><span[^>]*>([^<]*)<\/span>/g)]
  const held = buttons.filter((m) => ['Read more', 'Button'].includes(m[2]!))
  // one says what its host said, the other what Button says by default
  expect(held.map((m) => m[2]).sort()).toEqual(['Button', 'Read more'])
  // and both wear what Button wears now — styled once, not once per host
  for (const m of held) {
    const classes = m[1]!.split(' ')
    expect(classes).toContain('rounded-full')
    expect(classes).not.toContain('rounded-lg')
  }
})
