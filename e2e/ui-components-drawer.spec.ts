import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The Components column: the shared-slot rail behaviour, and a component's
// round trip — use one on a page, publish, and check the real exported page.
//
// The interactive components are the reason this spec exists. The fixture's
// Tabs and Dialog are built out of class-toggle interactions with groups and
// forced on/off states; nothing short of driving the published page proves
// that wiring is right.
//
// Named to sort AFTER smoke.spec: smoke owns the first-run flow and needs a
// server with no admin account yet, so any spec that logs in has to run later.

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

/** the drawer's rows carry a stable hook — `data-component` — so these don't
 *  hang off class strings */
const projectRow = (page: Page, name: string) => page.locator(`[data-component="${name}"]`)

/** the group header rows carry their own hook, like the Pages drawer's */
const groupRow = (page: Page, name: string) => page.locator(`[data-component-group="${name}"]`)

/** Escape, then wait for the dock to actually be gone.
 *
 * It closes on the next render flush, and the next action can outrun it —
 * leaving the dock's own 'Components' tab matching the rail button of the same
 * name, which reads as a strict-mode violation rather than as a race. */
async function closeDock(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-dock-tab]').first()).toBeHidden()
}

/** insert one of the project's components on the home page from the ⌘E dock */
async function insertComponent(page: Page, name: string) {
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator('[data-dock-item^="component:"]', { hasText: new RegExp(`^${name}$`) }).first().click()
  await closeDock(page)
}

test('the three left columns share one slot', async ({ page }) => {
  await openEditor(page)

  await rail(page, 'Components').click()
  await expect(page.getByPlaceholder('Search components…')).toBeVisible()

  // opening Pages takes the slot from Components
  await rail(page, 'Pages').click()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeVisible()
  await expect(page.getByPlaceholder('Search components…')).toBeHidden()

  // and Components takes it back
  await rail(page, 'Components').click()
  await expect(page.getByPlaceholder('Search components…')).toBeVisible()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeHidden()

  // the App button closes whatever holds it
  await page.getByRole('button', { name: 'App', exact: true }).click()
  await expect(page.getByPlaceholder('Search components…')).toBeHidden()
})

test('a group and a component are made from the drawer, and the row opens variants', async ({
  page,
}) => {
  await openEditor(page)
  await rail(page, 'Components').click()

  // the section "+" makes a group. It has no backing store of its own, so it
  // lives in the drawer until a component lands in it.
  await page.getByRole('button', { name: 'New group' }).click()
  const groupName = page.getByPlaceholder('e.g. Cards')
  await groupName.fill('Widgets')
  await groupName.press('Enter')
  await expect(groupName).toBeHidden()

  const group = groupRow(page, 'Widgets')
  await expect(group).toBeVisible()

  // an empty group says what to do with a button, not with prose; the group
  // row's hover "+" is the same action for a group that already has cards
  await group.hover()
  await expect(group.getByRole('button', { name: 'New component' })).toBeVisible()
  await page.getByRole('button', { name: 'Create component' }).click()
  const componentName = page.getByPlaceholder('e.g. Hero')
  await componentName.fill('Widget')
  await componentName.press('Enter')
  await expect(componentName).toBeHidden()

  const row = projectRow(page, 'Widget')
  await expect(row).toBeVisible()
  await expect(row.getByText('Widget')).toBeVisible()

  // ...in the group, which is now real
  await expect(groupRow(page, 'Widgets')).toBeVisible()

  // the row's "+" opens the component's settings with the new-axis field
  // focused, so a variant is one keystroke away
  await row.hover()
  await row.getByRole('button', { name: 'Add a variant' }).click()
  const newAxis = page.getByPlaceholder('New axis: size, variant…')
  await expect(newAxis).toBeFocused()
  await newAxis.fill('size')
  await newAxis.press('Enter')
  await expect(page.locator('[data-variant-axis="size"]')).toBeVisible()

  // and the category came across with the component
  await expect(page.locator('input[placeholder="Uncategorized"]')).toHaveValue('Widgets')
})

test('Tabs: clicking a tab swaps the panel, and tab one restores the default', async ({ page }) => {
  await openEditor(page)
  await insertComponent(page, 'Tabs')
  await publish(page)
  await page.goto('/')

  const first = page.getByText('The first panel is the one visible before anything is clicked.')
  const second = page.getByText('The second panel. Clicking its tab hides the others.')
  const third = page.getByText('The third panel, same again.')

  // panel 1 is visible with no JS having run — deliberately NOT an `appear`
  // binding, which the runtime force-fires after 3s
  await expect(first).toBeVisible()
  await expect(second).toBeHidden()

  await page.getByRole('button', { name: 'Details' }).click()
  await expect(second).toBeVisible()
  await expect(first).toBeHidden()

  // the group makes the panels exclusive
  await page.getByRole('button', { name: 'Activity' }).click()
  await expect(third).toBeVisible()
  await expect(second).toBeHidden()
  await expect(first).toBeHidden()

  // tab one is the "off" position of every effect
  await page.getByRole('button', { name: 'Overview' }).click()
  await expect(first).toBeVisible()
  await expect(second).toBeHidden()
  await expect(third).toBeHidden()

  // and the default panel stays put well past the runtime's 3s appear sweep
  await page.waitForTimeout(3500)
  await expect(first).toBeVisible()
})

test('Dialog: opens, dismisses from the overlay, and from Escape', async ({ page }) => {
  await openEditor(page)
  await insertComponent(page, 'Dialog')
  await publish(page)
  await page.goto('/')

  // the trigger is a nested Button: its click reaches the binding on the
  // wrapper the Dialog owns, which is the only place a host can bind
  const body = page.getByText('Make your changes here, then save when you are done.')
  await expect(body).toBeHidden()

  await page.getByRole('button', { name: 'Open dialog' }).click()
  await expect(body).toBeVisible()

  // the overlay and the buttons all drive ONE effect, keyed by target
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(body).toBeHidden()

  await page.getByRole('button', { name: 'Open dialog' }).click()
  await expect(body).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(body).toBeHidden()
})

test('renaming a component keeps every instance rendering', async ({ page }) => {
  await openEditor(page)
  await insertComponent(page, 'Card')

  await rail(page, 'Components').click()
  const row = projectRow(page, 'Card')
  await row.hover()
  await row.getByRole('button').last().click() // the row kebab
  // exact: the rail's "Project settings" button matches a loose 'Settings'
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const name = page.locator('input[placeholder="Card"]')
  await name.fill('Panel')
  await name.blur()

  await publish(page)
  await page.goto('/')
  // renamed in place: the instance still resolves to its master, so it keeps
  // the master's classes and copy
  await expect(page.getByText('Card title')).toBeVisible()
  await expect(page.locator('.bg-card').first()).toBeVisible()
})
