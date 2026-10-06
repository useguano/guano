import {
  test,
  expect,
  type Browser,
  type Locator,
  type Page,
  type APIRequestContext,
} from '@playwright/test'
import { loadFixture } from './fixtures/project'

// A CONTRIBUTOR edits content in place on the Play render.
//
// A contributor is pinned to Play, so the render is where they change a page's
// copy and images: double-click text to edit it, right-click for "Edit content"
// / "Replace background". (For a builder Play stays read-only — that half is
// in ui-layers.) Assertions land on the STORED project, read back as the admin:
// a contributor's write goes through the server's content merge, so what
// matters is what survived it, not what the contributor's DOM shows.
//
// Named to sort AFTER smoke.spec: smoke owns the first-run flow and needs a
// server with no admin account yet, so any spec that logs in has to run later.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const CONTRIB = { email: 'play-contrib@example.com', password: 'play-contrib-1' }
const KEY = 'guano-project%3Amain'

// The fixture nests each section's copy inside a pointer-events-none
// decoration, so no real pointer reaches its headings: those gestures are
// dispatched on the element (as ui-layers does). The Header's nav — a link,
// which also exercises the click-waits-for-dblclick path — takes real ones.
const HEADING = 'Freshness you can taste in the first sip.'
const SUBHEAD = 'Three ways to never run out.'

type Node = { id: string; type: string; content?: string; children?: Node[] }

async function signIn(page: Page, creds: { email: string; password: string }) {
  await page.goto('/admin/')
  const projectName = page.getByPlaceholder('Project name')
  const email = page.getByPlaceholder('Email')
  const ready = page.getByRole('button', { name: 'Pages', exact: true })
  await expect(projectName.or(email).or(ready).first()).toBeVisible({ timeout: 30_000 })
  if (await projectName.isVisible()) {
    await projectName.fill('Smoke Co')
    await email.fill(creds.email)
    await page.getByPlaceholder('Password (min. 8 characters)').fill(creds.password)
    await page.getByPlaceholder('Confirm password').fill(creds.password)
    await page.getByRole('button', { name: 'Setup project' }).click()
  } else if (await email.isVisible()) {
    await email.fill(creds.email)
    await page.getByPlaceholder('Password', { exact: true }).fill(creds.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
}

/** a contributor session in its own browser context (invited on first run) */
async function contributorPage(browser: Browser, admin: APIRequestContext, baseURL: string) {
  const context = await browser.newContext({ baseURL })
  const res = await admin.post('/api/users/invite', {
    data: { name: 'Play Contrib', email: CONTRIB.email, role: 'contributor' },
  })
  if (res.ok()) {
    const { token } = await res.json()
    const accepted = await context.request.post(`/api/invite/${token}/accept`, {
      data: { password: CONTRIB.password },
    })
    expect(accepted.ok()).toBeTruthy()
  } else {
    // invited and accepted on a previous run against the same data dir
    const login = await context.request.post('/api/auth/login', { data: CONTRIB })
    expect(login.ok()).toBeTruthy()
  }
  const page = await context.newPage()
  await page.goto('/admin/')
  return page
}

async function storedHome(admin: APIRequestContext) {
  const body = (await (await admin.get(`/api/store?keys=${KEY}`)).json()) as Record<string, string>
  const project = JSON.parse(body['guano-project:main']) as {
    pages: { elements: Node[] }[]
    components: { name: string; root: Node }[]
  }
  return project
}

/** a contextmenu dispatched on the element itself, at its on-screen position
 * (the menu opens at the pointer) — see the note on the fixture above */
async function rightClick(target: Locator) {
  // a real MouseEvent built in the page: Playwright's dispatchEvent makes a
  // bare Event for contextmenu, which carries no clientX/clientY
  await target.evaluate((el) => {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: r.x + 8,
        clientY: r.y + 8,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
}

function contents(nodes: Node[]): string[] {
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.content) out.push(n.content)
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

test('a contributor edits text in place on Play, and it survives the server merge', async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page, ADMIN)
  await loadFixture(page)
  const admin = page.request

  const contrib = await contributorPage(browser, admin, baseURL!)
  const site = contrib.locator('[data-site-scope]')
  const hero = site.locator('h2', { hasText: HEADING })
  await expect(hero).toBeVisible({ timeout: 30_000 })

  // there is no Edit / Play switch for a contributor — the render IS the surface
  await expect(contrib.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)

  // 1. double-click a heading, retype it, Enter commits
  const marker = `Edited by a contributor ${Date.now()}`
  await hero.dispatchEvent('dblclick')
  const editor = site.locator('span[contenteditable]')
  await expect(editor).toBeFocused()
  await contrib.keyboard.press('ControlOrMeta+A')
  await contrib.keyboard.type(marker)
  await contrib.keyboard.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(site.locator('h2', { hasText: marker })).toBeVisible()

  // 2. Escape SAVES on Play (Edit discards): a contributor has nowhere else
  //    to redo the typing
  const subMarker = `Escape keeps this ${Date.now()}`
  await site.locator('h2', { hasText: SUBHEAD }).dispatchEvent('dblclick')
  await expect(editor).toBeFocused()
  await contrib.keyboard.press('ControlOrMeta+A')
  await contrib.keyboard.type(subMarker)
  await contrib.keyboard.press('Escape')
  await expect(site.locator('h2', { hasText: subMarker })).toBeVisible()

  // 3. text inside a component instance is the INSTANCE's: the Header's
  //    "Pricing" nav link becomes "Plans" on this page, the master is untouched
  const pricing = site.locator('header nav span', { hasText: 'Pricing' })
  await pricing.dblclick()
  await expect(editor).toBeFocused()
  await contrib.keyboard.press('ControlOrMeta+A')
  await contrib.keyboard.type('Plans')
  await contrib.keyboard.press('Enter')
  await expect(site.locator('header nav span', { hasText: 'Plans' })).toBeVisible()

  // autosave → the contributor merge → the stored blob
  await expect
    .poll(
      async () => {
        const project = await storedHome(admin)
        const page = contents(project.pages[0].elements)
        return [page.includes(marker), page.includes(subMarker), page.includes('Plans')]
      },
      { timeout: 15_000 },
    )
    .toEqual([true, true, true])
  const header = (await storedHome(admin)).components.find((c) => c.name === 'Header')!
  expect(contents([header.root])).toContain('Pricing')
  expect(contents([header.root])).not.toContain('Plans')

  // 4. the right-click menu: content on a heading, background on a plain
  //    section — but never a background inside an instance (it is the
  //    master's, which a contributor's write cannot reach)
  await rightClick(site.locator('h2', { hasText: marker }))
  await expect(contrib.getByRole('button', { name: 'Edit content' })).toBeVisible()
  await expect(contrib.getByRole('button', { name: 'Replace background' })).toHaveCount(0)
  await contrib.keyboard.press('Escape')
  await expect(contrib.getByRole('button', { name: 'Edit content' })).toHaveCount(0)

  await rightClick(site.locator('section').first())
  await expect(contrib.getByRole('button', { name: 'Replace background' })).toBeVisible()
  await contrib.keyboard.press('Escape')

  await site.locator('header').first().click({ button: 'right', position: { x: 2, y: 2 } })
  await expect(contrib.getByRole('button', { name: 'Replace background' })).toHaveCount(0)

  // "Edit content" opens the same in-place editor as a double-click
  await rightClick(site.locator('h2', { hasText: marker }))
  await contrib.getByRole('button', { name: 'Edit content' }).click()
  await expect(editor).toBeFocused()
  await contrib.keyboard.press('Enter')

  await contrib.context().close()
})
