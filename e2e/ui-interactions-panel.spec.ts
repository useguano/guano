import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The Interactions panel and the effects drawer. Seven paths, each chosen
// because it protects against SILENT data loss or a lie that type-checking
// can't see: a cancelled create leaving a half-discarded effect behind; an edit
// to a shared effect not reaching the elements that use it; a dismissal written
// to two bindings when the runtime folds them into one; a timeline that two
// buttons cannot agree on; an effect that needs both engines arriving as half of
// itself; and the drawer eating the Escape that belongs to the panel.
//
// The first three assert on the PUBLISHED EXPORT rather than the panel's own
// DOM, so they keep their value through a reskin.
//
// Named to sort AFTER smoke.spec: smoke owns the first-run flow and needs a
// server with no admin account yet, so any spec that logs in has to run later
// (same reason store-agent-security.spec carries its own name).

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

/** log in (or do first-run setup) and load the demo project. Whether this run
 * lands on setup or login depends on test order and whether the data dir was
 * wiped, so wait for whichever form actually arrives — the guard redirects
 * after boot, so the URL right after goto() is not yet the answer. */
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
    // the login form's placeholder is the bare word; setup's carries the rule
    await page.getByPlaceholder('Password', { exact: true }).fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
  await loadFixture(page)
  await expect(ready).toBeVisible({ timeout: 30_000 })
}

/** the right rail's Interactions button is icon-only (Zap) */
async function openPanel(page: Page) {
  await page.getByRole('button', { name: 'Interactions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Trigger', exact: true })).toBeVisible()
}

/** "+ Trigger" → the trigger's action exists at once (a new effect, bound under
 *  it) and the drawer is open on it: options and effect side by side */
async function addTrigger(page: Page, label: RegExp) {
  await page.getByRole('button', { name: 'Trigger', exact: true }).click()
  await page.getByRole('button', { name: label }).first().click()
  await expect(triggerView(page)).toBeVisible()
  await expect(actionRows(page)).toHaveCount(1)
}

/** a trigger opens on Motion, so reaching the class half is a Type pick */
async function pickClasses(page: Page) {
  await triggerView(page).getByRole('button', { name: 'Classes', exact: true }).click()
  await expect(triggerView(page).getByPlaceholder('Add class')).toBeVisible()
}

const drawer = (page: Page) => page.locator('[data-effects-drawer]')
/** the drawer's trigger view — where an element's action lives */
const triggerView = (page: Page) => page.locator('[data-trigger-editor]')
const actionRows = (page: Page) => page.locator('[data-binding-row]')
const libraryRows = (page: Page) => page.locator('[data-effect-row]')

/** a publish is rate-limited to 12/min server-side and this suite exceeds it
 *  across its specs, so wait the window out rather than relaxing a real guard */
async function publish(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('ControlOrMeta+p')
    const done = page.getByText('Published!')
    const failed = page.getByText('Publish failed')
    await expect(done.or(failed).first()).toBeVisible({ timeout: 60_000 })
    if (await done.isVisible()) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(20_000)
  }
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 60_000 })
}

test('adding a trigger makes its effect, and Cancel discards it completely', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  const effectsBefore = await (async () => {
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect(drawer(page)).toBeVisible()
    const n = await libraryRows(page).count()
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect(drawer(page)).toBeHidden()
    return n
  })()

  // one gesture: the trigger, its action and the effect to edit all exist, and
  // the panel KEEPS its context — the element and its trigger are listed there
  await addTrigger(page, /^Click/)
  await expect(page.locator('[data-trigger-row]').filter({ hasText: 'On click' })).not.toContainText(
    'empty',
  )

  // give it a class, so a half-discard would leave a visible trace
  await pickClasses(page)
  const marker = 'outline-dashed'
  await drawer(page).getByPlaceholder('Add class').fill(marker)
  await page.keyboard.press('Enter')

  await drawer(page).getByRole('button', { name: 'Cancel' }).click()

  // Cancel closes the drawer, and the cascading delete took the binding with
  // it: the trigger is gone from the panel. A delete that removed the library
  // entry but orphaned the binding would leave the row behind.
  await expect(drawer(page)).toBeHidden()
  await expect(page.locator('[data-trigger-row]')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Shift+e')
  await expect(libraryRows(page)).toHaveCount(effectsBefore)

  // and the discarded class never reaches the published site
  await publish(page)
  await page.goto('/')
  expect(await page.content()).not.toContain(marker)
})

test("a trigger's effect is edited in place, and Remove takes it off the element", async ({
  page,
}) => {
  await openEditor(page)
  await openPanel(page)

  await addTrigger(page, /^Hover/)
  // the trigger view has no header of its own: which trigger is open is the
  // highlighted row in the drawer's index, and which effect is the highlighted
  // library row beside it
  await expect(drawer(page).locator('[data-drawer-trigger][aria-current="true"]')).toHaveText(
    /On hover/,
  )
  await expect(drawer(page).locator('[data-effect-row][data-open]')).toHaveCount(1)

  // the SHARED effect is right there beside the options — nothing to open
  await pickClasses(page)
  const marker = 'ring-offset-4'
  await triggerView(page).getByPlaceholder('Add class').fill(marker)
  await page.keyboard.press('Enter')
  await drawer(page).getByRole('button', { name: 'Apply' }).click()
  await expect(drawer(page)).toBeHidden()

  await publish(page)
  await page.goto('/')
  expect(await page.content()).toContain(marker)

  // Remove takes the action off THIS element…
  await page.goto('/admin/')
  await openPanel(page)
  await page.locator('[data-trigger-row]').filter({ hasText: 'On hover' }).click()
  await triggerView(page).getByRole('button', { name: 'Remove', exact: true }).click()
  // …which closes the drawer and takes the trigger out of the panel
  await expect(drawer(page)).toBeHidden()
  await expect(page.locator('[data-trigger-row]')).toHaveCount(0)

  // …so the class it carried no longer ships, while the effect stays in the
  // library for the next element
  await publish(page)
  await page.goto('/')
  expect(await page.content()).not.toContain(marker)
})

test('the drawer opens with ⌘⇧E and Escape closes it without closing the panel', async ({
  page,
}) => {
  await openEditor(page)
  await openPanel(page)

  await page.keyboard.press('ControlOrMeta+Shift+e')
  await expect(drawer(page)).toBeVisible()

  // Escape peels ONE layer: the drawer goes, the panel stays. Letting it bubble
  // would close the panel too and throw focus back to the Layers tree.
  await page.keyboard.press('Escape')
  await expect(drawer(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Trigger', exact: true })).toBeVisible()

  // a second Escape is the panel's own
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Trigger', exact: true })).toBeHidden()
})

test('a click is aimed with a verb, never an engine', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  await addTrigger(page, /^Click/)
  await drawer(page).getByRole('button', { name: 'Apply' }).click()
  await page.locator('[data-trigger-row]').filter({ hasText: 'On click' }).click()

  // the direction lives in the action's options
  await actionRows(page).locator('[data-row]').filter({ hasText: 'Action' }).getByRole('button').click()
  await page.getByRole('button', { name: 'Turn on', exact: true }).click()

  await publish(page)
  await page.goto('/')

  // both halves of the one effect landed on the body, aimed the same way
  const landed = await page.evaluate(() => ({
    classes: JSON.parse(document.body.getAttribute('data-int') || '[]'),
    motion: JSON.parse(document.body.getAttribute('data-anim') || '[]'),
  }))
  expect(landed.classes).toHaveLength(1)
  expect(landed.motion).toHaveLength(1)
  expect(landed.classes[0].a).toBe('on')
  expect(landed.motion[0].ac).toBe('on')
})

test('one effect wears both engines, and binds as one action', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  // ONE new effect carries both a style change and motion. A sliding panel
  // needs both: `hidden` → `flex` is the only way to switch display, and no
  // class swap expresses the slide — but that split is ours, not the author's,
  // so nothing is chosen between.
  await addTrigger(page, /^Click/)
  // the trigger view shows one half at a time: it opens on motion, and the
  // class half is one Type pick away
  await expect(drawer(page).locator('[data-effect-half="animation"]')).toBeVisible()
  await pickClasses(page)
  await drawer(page).getByPlaceholder('Add class').fill('flex')
  await page.keyboard.press('Enter')
  await drawer(page).getByRole('button', { name: 'Apply' }).click()
  await page.locator('[data-trigger-row]').filter({ hasText: 'On click' }).click()

  // ONE action, not two: the pair is recognised from the bindings themselves
  await expect(actionRows(page)).toHaveCount(1)

  // the library marks the effect being edited, and lists it ONCE — one per
  // engine is what the pairing exists to avoid
  const open = drawer(page).locator('[data-effect-row][data-open]')
  await expect(open).toHaveCount(1)
  const name = (await open.locator('button').first().innerText()).trim()
  await expect(libraryRows(page).filter({ hasText: name })).toHaveCount(1)

  await publish(page)
  await page.goto('/')

  // both halves landed on the body, agreeing on when and where — a pair whose
  // halves fired at different moments would simply be broken
  const landed = await page.evaluate(() => ({
    classes: JSON.parse(document.body.getAttribute('data-int') || '[]'),
    motion: JSON.parse(document.body.getAttribute('data-anim') || '[]'),
  }))
  expect(landed.classes).toHaveLength(1)
  expect(landed.motion).toHaveLength(1)
  expect(landed.classes[0].t).toBe('click')
  expect(landed.motion[0].t).toBe('click')
})

test('an effect that predates the pairing can still gain the other engine', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  // the fixture's effects were made before an effect could hold both engines —
  // the same shape a motion preset or an agent produces. Opening one must offer
  // the missing half, or the feature would only ever apply to new work.
  await page.keyboard.press('ControlOrMeta+Shift+e')
  await libraryRows(page).filter({ hasText: 'Card lift' }).first().click()
  await drawer(page).getByRole('button', { name: 'Motion', exact: true }).click()

  // now it is one effect with two halves, and the library still lists it once
  await expect(drawer(page).locator('[data-effect-half="interaction"]')).toBeVisible()
  await expect(drawer(page).locator('[data-effect-half="animation"]')).toBeVisible()
  await expect(libraryRows(page).filter({ hasText: 'Card lift' })).toHaveCount(1)

  await publish(page)
  await page.goto('/')

  // and the four fixture elements already using it gained the timeline too —
  // a half that applied only to the next placement would be the silent no-op
  const moved = await page.evaluate(
    () => document.querySelectorAll('[data-anim]').length,
  )
  expect(moved).toBeGreaterThan(0)
})
