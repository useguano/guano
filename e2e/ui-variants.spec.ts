import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// Variants — how ONE component comes in several looks.
//
// The whole loop, through the UI a person uses: name an axis in the
// component's settings, wear an option on the board, style it in the Style
// panel's layer, pick it on one instance of two, and read both off the
// published page. What matters most is the last part: an override REPLACES
// the base class it conflicts with, because two Tailwind classes on one
// property resolve by stylesheet order, not by their order on the element.
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


test('an axis is named, an option styled, and one instance of two wears it', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // two Buttons on the page
  await rows(page).first().click()
  await insertComponent(page, 'Button')
  await rows(page).first().click()
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator('[data-dock-item^="component:"]', { hasText: /^Button$/ }).first().click()
  await closeDock(page)
  // the instance wrappers: rows that say 'Button' and nothing else (the
  // elements inside add their type after the label)
  const instances = rows(page).filter({ hasText: /^\s*Button\s*$/ })
  await expect(instances).toHaveCount(2)

  // --- name the axis, in the component's settings
  await rail(page, 'Components').click()
  const row = componentRow(page, 'Button')
  await row.hover()
  await row.getByRole('button').last().click() // the row kebab
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  // the fixture's Button comes with two axes already; this adds a third
  const axes = page.locator('[data-variant-axes]')
  await expect(page.locator('[data-variant-axis="variant"]')).toBeVisible()
  await expect(page.locator('[data-variant-axis="size"]')).toBeVisible()
  await axes.getByPlaceholder('New axis: size, variant…').fill('Tone')
  await page.keyboard.press('Enter')
  // tidied to the name rule, and born with one option: the default
  const axis = page.locator('[data-variant-axis="tone"]')
  await expect(axis.locator('[data-variant-option="default"]')).toBeVisible()
  await axis.getByPlaceholder('Add an option…').fill('loud')
  await page.keyboard.press('Enter')
  await expect(axis.locator('[data-variant-option="loud"]')).toBeVisible()

  // a name that is already taken is refused, and says so
  await axes.getByPlaceholder('New axis: size, variant…').fill('size')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-variant-error]')).toContainText('already has')
  await page.getByRole('button', { name: 'Back', exact: true }).click()

  // --- the board draws the component once per option: point at one, style it
  const drawing = (option: string) => page.locator(`[data-board-variant="Button:tone:${option}"]`)
  await expect(page.locator('[data-board-variant^="Button:variant:"]')).toHaveCount(6)
  await expect(page.locator('[data-board-variant^="Button:tone:"]')).toHaveCount(2)
  // by its edge: its centre is the span holding its words, which is what a
  // click there would select
  await drawing('loud').locator('button[data-node-id]').click({ position: { x: 3, y: 3 } })
  await expect(drawing('loud')).toHaveAttribute('data-board-variant-active', 'true')
  await page.getByRole('button', { name: 'Style', exact: true }).click()

  // pointing at the drawing is what chose the layer: nothing to pick
  const layer = page.locator('[data-style-layer]')
  await expect(layer.getByRole('button', { name: 'tone: loud' })).toHaveAttribute('aria-pressed', 'true')
  const classes = page.getByPlaceholder('Add class')
  await classes.fill('h-8')
  await page.keyboard.press('Enter')
  await classes.fill('px-3')
  await page.keyboard.press('Enter')

  // that drawing wears it at once, and the others do not: the override is its own
  const loud = drawing('loud').locator('button[data-node-id]')
  const plain = drawing('default').locator('button[data-node-id]')
  await expect(loud).toHaveClass(/(^| )h-8( |$)/)
  await expect(loud).not.toHaveClass(/(^| )h-9( |$)/)
  await expect(plain).toHaveClass(/(^| )h-9( |$)/)
  await expect(plain).not.toHaveClass(/(^| )h-8( |$)/)
  await page.keyboard.press('Escape')

  // --- one instance of the two wears it
  await rail(page, 'App').click()
  await openLayers(page)
  await instances.first().click()
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.locator('[data-instance-pick="tone"]').getByRole('button', { name: 'loud' }).click()
  await page.keyboard.press('Escape')

  await publish(page)
  const html = await (await page.request.get('/')).text()
  const buttons = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*><span[^>]*>Button<\/span>/g)].map(
    (m) => m[1]!.split(' '),
  )
  expect(buttons).toHaveLength(2)
  const small = buttons.find((c) => c.includes('h-8'))!
  const normal = buttons.find((c) => c.includes('h-9'))!
  expect(small).toBeTruthy()
  expect(normal).toBeTruthy()
  // replaced, not stacked beside
  expect(small).not.toContain('h-9')
  expect(small).not.toContain('px-4')
  expect(small).toContain('px-3')
  expect(normal).toContain('px-4')
  // what the option does not touch comes from the base, for both
  expect(small).toContain('bg-primary')
  // and the stylesheet carries the override's classes
  const css = await (await page.request.get('/assets/style.css')).text()
  expect(css).toContain('.h-8')
})
