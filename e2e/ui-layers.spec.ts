import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The Layers tree — the surface that replaced the code editor.
//
// What matters here is what the editor was the ONLY way to do, and what no
// unit check reaches: moving an element INTO another container (the canvas
// drag has only ever offered before/after), naming a ref, and the keyboard
// route into the panels. Assertions land on the published export where they
// can, so this keeps its value through a reskin.
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

/** drag one row onto another, landing in the given zone of the target row */
async function dragRow(page: Page, from: string, to: string, zone: 'before' | 'after' | 'inside') {
  const a = await page.locator(`[data-layer-row="${from}"]`).boundingBox()
  const b = await page.locator(`[data-layer-row="${to}"]`).boundingBox()
  if (!a || !b) throw new Error('row not found')
  const y = b.y + b.height * (zone === 'before' ? 0.1 : zone === 'after' ? 0.9 : 0.5)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, y, { steps: 12 })
  await page.mouse.up()
}

/** expand a component's layers in the Components drawer */
async function insertOnBoardSetup(page: Page) {
  await page.locator('[data-component="Alert"] [data-row-toggle]').click()
  await expect(rows(page).first()).toBeVisible()
}

/** the node id of the row at `index` */
const idAt = async (page: Page, index: number) =>
  (await rows(page).nth(index).getAttribute('data-layer-row'))!

test('the layers column lists the page and follows the canvas selection', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // the body is the root row, and the tree is deep enough to be real
  await expect(rows(page).first()).toContainText('body')
  expect(await rows(page).count()).toBeGreaterThan(5)

  // selecting on the canvas reveals and highlights the row. A LEAF, so the
  // click can only land on the element itself: a link is a container, and
  // clicking one selects the span holding its words.
  const leaf = page.locator('nav span[data-node-id]').first()
  await leaf.click()
  const id = await leaf.getAttribute('data-node-id')
  await expect(page.locator(`[data-layer-row="${id}"]`)).toHaveClass(/bg-accent\/30/)
})

test('dragging a row INTO a container re-parents it, and it publishes that way', async ({
  page,
}) => {
  await openEditor(page)
  await openLayers(page)

  // build a known shape at the end of the body: a section, then a heading
  // beside it (not inside it)
  await rows(page).first().click() // the body
  await insertFromDock(page, 'section')
  const sectionId = await idAt(page, (await rows(page).count()) - 1)
  await rows(page).first().click()
  await insertFromDock(page, 'h2')
  const headingId = await idAt(page, (await rows(page).count()) - 1)

  // they are siblings — the heading is NOT inside the section
  await expect(page.locator(`[data-layer-row="${sectionId}"]`)).toBeVisible()
  const depthOf = async (id: string) =>
    Number(
      (await page.locator(`[data-layer-row="${id}"]`).evaluate(
        (el) => (el as HTMLElement).style.paddingLeft,
      )).replace('px', ''),
    )
  expect(await depthOf(headingId)).toBe(await depthOf(sectionId))

  // re-parenting by dragging into the middle of a container: the one thing
  // only the code editor could do
  await dragRow(page, headingId, sectionId, 'inside')
  await expect
    .poll(async () => (await depthOf(headingId)) > (await depthOf(sectionId)))
    .toBe(true)

  await publish(page)
  await page.goto('/')
  // the published markup carries the nesting, so it really moved in the tree
  const nested = await page.locator('section').filter({ has: page.locator('h2') }).count()
  expect(nested).toBeGreaterThan(0)
})

test('a row names a ref, and refuses one already used on the page', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  await rows(page).first().click()
  await insertFromDock(page, 'section')
  const first = await idAt(page, (await rows(page).count()) - 1)
  await rows(page).first().click()
  await insertFromDock(page, 'section')
  const second = await idAt(page, (await rows(page).count()) - 1)

  // Enter on the selected row opens the inline rename (the ref had no UI at
  // all before this — it could only be typed in code)
  await page.locator(`[data-layer-row="${first}"]`).dblclick()
  const input = page.locator(`[data-layer-row="${first}"] input`)
  await input.fill('hero')
  await input.press('Enter')
  await expect(page.locator(`[data-layer-row="${first}"]`)).toContainText('#hero')

  // the same ref twice on one page is refused, and says why
  await page.locator(`[data-layer-row="${second}"]`).dblclick()
  const dup = page.locator(`[data-layer-row="${second}"] input`)
  await dup.fill('hero')
  await dup.press('Enter')
  await expect(dup).toBeVisible() // still editing: the write was refused
  await expect(page.locator(`[data-layer-row="${second}"]`)).not.toContainText('#hero')
})

test('S, D and I open the panels for the selected row', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // the code editor's typed '(' / '[' / '{' were the only keyboard way in
  await rows(page).nth(3).click()
  await page.keyboard.press('s')
  await expect(page.getByText('CLASSES')).toBeVisible()
  // the panel opens with its input focused, so the next key is TYPED there —
  // Escape closes the panel and hands the keyboard back to the tree
  await expect(page.getByPlaceholder('Add class')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByText('CLASSES')).toBeHidden()
  await page.keyboard.press('i')
  await expect(page.getByRole('button', { name: 'Interactions', exact: true })).toHaveClass(
    /text-accent-foreground/,
  )
})

test('a button lands holding its words, on a page and in a component', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // on a PAGE: a button is a container, so an insert that landed it empty
  // would put a zero-size box on the canvas. It arrives with a span instead.
  await rows(page).first().click()
  const before = await rows(page).count()
  await insertFromDock(page, 'button')
  await expect(rows(page)).toHaveCount(before + 2) // the button and its span
  await publish(page)
  const live = await page.request.get('/')
  expect(await live.text()).toMatch(/<button[^>]*><span[^>]*>Button<\/span><\/button>/)
  await page.keyboard.press('Escape') // the publish dialog

  // in a COMPONENT: the master has no code to carry the child, so its backend
  // has to build the same pair itself
  await rail(page, 'Components').click()
  await insertOnBoardSetup(page)
  const masterRows = await rows(page).count()
  await rows(page).first().click()
  await insertFromDock(page, 'button')
  await expect(rows(page)).toHaveCount(masterRows + 2)
})

test('an icon is picked from the grid and publishes as an inline svg', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // a button, then an icon inside it: the insert lands in the selection
  await rows(page).first().click()
  await insertFromDock(page, 'button')
  await insertFromDock(page, 'icon')

  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await expect(page.locator('[data-icon-current]')).toHaveText('No icon picked')

  // the table is the whole icon set, loaded on demand — so the grid is empty
  // for a moment, and searching is how anyone finds anything in it
  await page.getByPlaceholder('Search icons…').fill('arrow right')
  await page.locator('[data-icon-option="arrow-right"]').click()
  await expect(page.locator('[data-icon-current]')).toHaveText('arrow-right')
  await page.keyboard.press('Escape')

  await publish(page)
  const html = await (await page.request.get('/')).text()
  expect(html).toMatch(
    /<button[^>]*><span[^>]*>Button<\/span><svg[^>]*data-icon="lucide:arrow-right"[^>]*>.*?<\/svg><\/button>/,
  )
})

test('one instance hides a part of its component; the other keeps it', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // two instances of the same component, side by side
  // (the second insert finds it among the project's own components)
  await rows(page).first().click()
  await insertComponent(page, 'Alert')
  await rows(page).first().click()
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator('[data-dock-item^="component:"]', { hasText: 'Alert' }).first().click()
  await closeDock(page)
  const headings = rows(page).filter({ hasText: 'Heads up' })
  await expect(headings).toHaveCount(2)

  // hide the heading in ONE of them. The eye only shows on a hovered row —
  // and then stays, because a hidden row has to say so without being pointed at
  await headings.first().hover()
  await headings.first().locator('[data-layer-eye]').click()
  await expect(page.locator('[data-layer-hidden]')).toHaveCount(1)
  await rows(page).first().hover()
  await expect(headings.first().locator('[data-layer-eye]')).toBeVisible()

  // the canvas shows what the site will: one heading left per frame
  const frames = await page.locator('[data-node-id]', { hasText: /^Heads up$/ }).count()

  await publish(page)
  const html = await (await page.request.get('/')).text()
  expect(html.match(/Heads up/g)!).toHaveLength(1)
  await page.keyboard.press('Escape')

  // showing it again leaves no trace: the flag is dropped, not set to false
  await headings.first().hover()
  await headings.first().locator('[data-layer-eye]').click()
  await expect(page.locator('[data-layer-hidden]')).toHaveCount(0)
  await expect(page.locator('[data-node-id]', { hasText: /^Heads up$/ })).toHaveCount(frames * 2)
})

test('a component gains an element on the board, and its page instance follows', async ({
  page,
}) => {
  await openEditor(page)
  await openLayers(page)

  // put a Card on the page: an instance for the master edit to reach
  await rows(page).first().click()
  await insertComponent(page, 'Card')
  const pageRows = await rows(page).count()

  // edit the COMPONENT: expanding its row in the Components drawer shows its
  // layers. Structure there is the master's — pushed to every instance.
  await rail(page, 'Components').click()
  await componentRow(page, 'Card').locator('[data-row-toggle]').click()
  await expect(rows(page).first()).toBeVisible()
  const masterRows = await rows(page).count()

  await rows(page).first().click()
  await insertFromDock(page, 'paragraph')
  await expect(rows(page)).toHaveCount(masterRows + 1)

  // back on the page, the instance grew the same element
  await rail(page, 'App').click()
  await openLayers(page)
  await expect(rows(page)).toHaveCount(pageRows + 1)
})

test('removing an element from a component removes it from the page instance', async ({
  page,
}) => {
  await openEditor(page)
  await openLayers(page)
  await rows(page).first().click()
  await insertComponent(page, 'Alert')

  // delete the heading on the board — the instance on the page loses it too
  await rail(page, 'Components').click()
  await page.locator('[data-board-card]').filter({ hasText: 'Heads up' }).first()
    .getByText('Heads up').first().click()
  await page.keyboard.press('Backspace')

  await publish(page)
  await page.goto('/')
  await expect(page.getByText('Heads up')).toHaveCount(0)
  // the rest of the component survived
  await expect(page.getByText('Something worth knowing before you carry on.')).toBeVisible()
})

test('Pages and Components share one column; layers live inside each', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // the Layers view is a layer of the Pages drawer: Back returns to the list
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)

  // Components puts the board on the canvas AND takes the column
  await rail(page, 'Components').click()
  await expect(page.getByPlaceholder('Search components…')).toBeVisible()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeHidden()
  await expect(page.locator('[data-board-card]').first()).toBeVisible()

  // a component's layers unfold under its row
  await page.locator('[data-component="Alert"] [data-row-toggle]').click()
  // the alert, its icon, the text column, its title and its description
  await expect(rows(page)).toHaveCount(5)

  // selecting on the board opens the component it belongs to
  await page.locator('[data-board-card]', { hasText: 'Card title' }).first().getByText('Card title').click()
  await expect(rows(page).filter({ hasText: 'Card title' })).toBeVisible()
})

test('a collection has settings: its fields and its URL', async ({ page }) => {
  await openEditor(page)
  await rail(page, 'Pages').click()

  const row = page.locator('[data-collection-row]').first()
  await row.hover()
  await row.getByRole('button').last().click() // the row kebab
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  // the demo's post collection carries its fields
  await expect(page.locator('[data-field="title"]')).toBeVisible()
  const before = await page.locator('[data-field]').count()
  await page.getByRole('button', { name: 'Add field' }).click()
  await expect(page.locator('[data-field]')).toHaveCount(before + 1)

  // the hint spells out where entries publish, and follows the prefix
  const prefix = page.locator('input[placeholder="post"]')
  await prefix.fill('journal')
  await prefix.press('Enter')
  await expect(page.getByText('/journal/my-entry')).toBeVisible()
})

test('the Edit / Play toggle swaps the surface, and Play edits nothing', async ({
  page,
}) => {
  await openEditor(page)

  // the switch is on the canvas beside Insert, never in the rail
  const edit = page.getByRole('button', { name: 'Edit', exact: true })
  const play = page.getByRole('button', { name: 'Play', exact: true })
  await expect(edit).toBeVisible()
  await expect(play).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0)

  // open a page's layers, then leave for Play: layers are an Edit-surface
  // view, so the drawer drops back to the page list
  await openLayers(page)
  await expect(rows(page).first()).toBeVisible()
  await play.click()

  await expect(page.locator('[data-frame-drop]')).toHaveCount(0) // no frames
  await expect(rows(page)).toHaveCount(0) // no tree
  await expect(page.getByPlaceholder('Search pages, items…')).toBeVisible()
  // and no way back into structure from a row
  const row = page.locator('[data-page-row="Home"]')
  await row.hover()
  await expect(row.getByRole('button', { name: 'Edit layers' })).toHaveCount(0)

  // For a builder Play is READ-ONLY: they edit on the Edit canvas, so the
  // gestures a contributor edits content with in Play — double-click for text,
  // right-click for the "Edit content" menu — do nothing at all here
  // (ui-preview-editing covers the contributor side).
  const hero = page.locator('[data-site-scope] h1').first()
  await expect(hero).toBeVisible({ timeout: 30_000 })
  await hero.dispatchEvent('dblclick')
  await expect(page.locator('[data-site-scope] span[contenteditable]')).toHaveCount(0)
  await hero.dispatchEvent('contextmenu')
  await expect(page.getByRole('button', { name: 'Edit content' })).toHaveCount(0)

  // Edit brings the frames and the way in back
  await edit.click()
  await expect(page.locator('[data-frame-drop]').first()).toBeVisible()
  await row.hover()
  await expect(row.getByRole('button', { name: 'Edit layers' })).toHaveCount(1)

  // the board has nothing to play, so it carries no toggle
  await rail(page, 'Components').click()
  await expect(page.locator('[data-board-card]').first()).toBeVisible({ timeout: 15_000 })
  await expect(play).toHaveCount(0)
  await expect(edit).toHaveCount(0)
})
