import { test, expect, type Locator, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The comments review loop, and the four things it got wrong.
//
//  1. The tool stayed armed after a drop, so the crosshair outlived the thread
//     it had just opened and the next click placed another empty pin.
//  2. Every comment was signed "You" — a hard-coded constant, so a two-person
//     review could not tell who had written what.
//  3. A pin was anchored to a node id alone. The canvas renders the same tree
//     once per breakpoint frame, so the lookup answered with whichever frame
//     came first in the DOM: a note left on the Tablet layout was drawn on the
//     Desktop one, at the same fractional offset. That read both as "comments
//     are per page, not per breakpoint" and as "the pin is not where I
//     clicked" — and the pin was positioned by its top-left while its tail is
//     its bottom-left corner, so it hung a pin-height below the click too.
//  4. Nothing recorded what anyone had seen, so new comments stayed invisible
//     until you went looking for them.
//
// Named to sort AFTER smoke.spec, which owns the first-run flow.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const KEY = 'guano-project%3Amain'
const RAW_KEY = 'guano-project:main'

// the fixture's frames and its one real page
const TABLET = 'b096da25-0789-4796-a4d6-6ecc85c75367'
const DESKTOP = 'f8710d65-cbcc-44fa-a1e3-6f6339b2ac0b'
const HOME = 'feba33ca-a1e5-493e-b708-5faab739945d'

type StoredComment = {
  id: string
  text: string
  author: string
  authorId?: string
  anchor?: { nodeId: string; rx: number; ry: number; breakpointId?: string }
}

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

/** the element the canvas would anchor a comment to at this point, and its box
 *  in that same instant */
async function nodeAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null
    const el = hit?.closest('[data-node-id]') as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { nodeId: el.dataset.nodeId!, left: r.left, top: r.top, width: r.width, height: r.height }
  }, point)
}

/**
 * Wait for the node under a point to hold still.
 *
 * `CanvasEditor` compiles Tailwind in the BROWSER (`@tailwindcss/browser`, so
 * classes typed at runtime work) and the project's fonts load after first
 * paint, so the frames reflow a few hundred ms in — in this fixture the header
 * under the click is 24.4px tall before the stylesheet lands and 19.5px after.
 * Watching the FRAME is no good: its own box never changes, so the wait
 * returned instantly and the reflow was still pending.
 */
async function settledAt(page: Page, point: { x: number; y: number }) {
  await page.evaluate(() => document.fonts.ready)
  let last = ''
  let held = 0
  await expect(async () => {
    const sig = JSON.stringify(await nodeAt(page, point))
    held = sig !== 'null' && sig === last ? held + 1 : 0
    last = sig
    // four agreeing samples ~600ms apart in total, not two: the compile is
    // debounced, so a single quiet gap proves nothing
    expect(held, `canvas still reflowing at ${point.x},${point.y}`).toBeGreaterThanOrEqual(3)
  }).toPass({ timeout: 20_000, intervals: [150, 150, 150, 150, 200, 300, 500] })
}

async function readProject(page: Page) {
  const res = await page.request.get(`/api/store?keys=${KEY}`)
  const map = await res.json()
  return JSON.parse(map[RAW_KEY])
}

async function storedComments(page: Page): Promise<StoredComment[]> {
  return (await readProject(page)).comments ?? []
}

/** write the comment list as somebody else, with the editor closed so its
 * autosave cannot land on top of the seed (loadFixture's rule) */
async function seedComments(page: Page, comments: unknown[]) {
  await page.goto('about:blank')
  const project = await readProject(page)
  project.comments = comments
  const put = await page.request.put(`/api/store/${KEY}`, { data: JSON.stringify(project) })
  expect(put.ok()).toBeTruthy()
  await page.goto('/admin/')
}

test('a comment lands in the frame it was dropped in, signed by its author', async ({ page }) => {
  await openEditor(page)

  const tablet = page.locator(`[data-breakpoint-id="${TABLET}"]`)
  await expect(tablet).toBeVisible()
  const offset = { x: 24, y: 24 }
  const framePos = (await tablet.boundingBox())!
  const clicked = { x: framePos.x + offset.x, y: framePos.y + offset.y }

  // arm the tool and drop a pin inside the TABLET frame. Whatever node is
  // under the click (at minimum the page body) is rendered in all three
  // frames, which is exactly the ambiguity the anchor's breakpoint resolves.
  await page.keyboard.press('c')
  await expect(page.locator('.cursor-crosshair')).toHaveCount(1)
  await settledAt(page, clicked)
  // the box the anchor will be computed against, read in the instant before
  // the click so a later reflow cannot make this number a lie
  const target = (await nodeAt(page, clicked))!
  await tablet.click({ position: offset })

  // the thread opens on the new pin — the first message becomes the comment
  const draft = page.getByPlaceholder('Add a comment…')
  await expect(draft).toBeVisible()
  await draft.fill('Headline wraps badly at this width.')
  await draft.press('Enter')

  // one press of C, one comment: the tool disarms itself
  await expect(page.locator('.cursor-crosshair')).toHaveCount(0)
  // ...and the comment is signed by the signed-in user, never "You"
  await expect(page.getByText(`${ADMIN.email} says:`)).toBeVisible()
  await expect(page.getByText('You says:')).toHaveCount(0)

  await expect(async () => {
    const comments = await storedComments(page)
    expect(comments).toHaveLength(1)
    expect(comments[0].text).toBe('Headline wraps badly at this width.')
    expect(comments[0].author).toBe(ADMIN.email)
    expect(comments[0].authorId).toBeTruthy()
    // the frame is on the anchor — this is what keeps the pin off the Desktop
    // render of the very same node
    expect(comments[0].anchor?.breakpointId).toBe(TABLET)
  }).toPass({ timeout: 10_000 })

  await page.keyboard.press('Escape')
  const pin = page.getByRole('button', { name: 'Comment pin' })
  await expect(pin).toHaveCount(1)

  // 1. the anchor REPRODUCES the click, in the box that existed when it
  //    happened. An anchor is relative (rx/ry inside the node), so this is the
  //    only frame of reference in which "where I clicked" means anything.
  const anchor = (await storedComments(page))[0].anchor!
  expect(anchor.nodeId).toBe(target.nodeId)
  expect(Math.abs(target.left + anchor.rx * target.width - clicked.x)).toBeLessThan(1)
  expect(Math.abs(target.top + anchor.ry * target.height - clicked.y)).toBeLessThan(1)

  // 2. the pin is DRAWN at that anchor's current position, by its tail. Node,
  //    pin and both frames are measured in ONE instant: the canvas reflows as
  //    the browser-side Tailwind compile lands, and a pin read a frame later
  //    than the node it is anchored to is off by exactly that reflow — which
  //    is what made this assertion fail alone and pass in a full run.
  const drawn = await page.evaluate(
    ({ nodeId, bp, desktopBp, rx, ry }) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }
      const frame = document.querySelector(`[data-breakpoint-id="${bp}"]`)!
      const node = frame.querySelector(`[data-node-id="${nodeId}"]`)!
      const r = node.getBoundingClientRect()
      const pin = document.querySelector('[aria-label="Comment pin"]')!
      const p = pin.getBoundingClientRect()
      return {
        want: { x: r.left + rx * r.width, y: r.top + ry * r.height },
        // the pin's TAIL is its bottom-left corner, not its top-left — it used
        // to be positioned by the latter and hung a pin-height below the click
        tail: { x: p.left, y: p.bottom },
        centreX: (p.left + p.right) / 2,
        frame: box(frame),
        desktop: box(document.querySelector(`[data-breakpoint-id="${desktopBp}"]`)!),
      }
    },
    { nodeId: anchor.nodeId, bp: TABLET, desktopBp: DESKTOP, rx: anchor.rx, ry: anchor.ry },
  )
  expect(Math.abs(drawn.tail.x - drawn.want.x)).toBeLessThan(1)
  expect(Math.abs(drawn.tail.y - drawn.want.y)).toBeLessThan(1)

  // 3. ...which puts it over the tablet frame, and nowhere near the desktop one
  expect(drawn.centreX).toBeGreaterThan(drawn.frame.left)
  expect(drawn.centreX).toBeLessThan(drawn.frame.right)
  expect(drawn.centreX < drawn.desktop.left || drawn.centreX > drawn.desktop.right).toBeTruthy()
})

test('unseen comments show on the rail, and opening the panel clears them', async ({ page }) => {
  await openEditor(page)
  await seedComments(page, [
    {
      id: 'comment-from-someone-else',
      pageId: HOME,
      text: 'Can we try a darker hero?',
      author: 'Dana Reviewer',
      authorId: 'another-user-entirely',
      resolved: false,
      createdAt: Date.now(),
      replies: [],
    },
  ])

  // the count rides on the button's accessible name: at this size a numeral
  // would be unreadable, so the dot is what a sighted user sees
  const unread = page.getByRole('button', { name: 'Comments, 1 unread' })
  await expect(unread).toBeVisible({ timeout: 30_000 })
  await unread.click()

  // the panel names the author and the page, and reading it puts the dot out
  await expect(page.getByText('Can we try a darker hero?')).toBeVisible()
  await expect(page.getByText(/by Dana Reviewer/)).toBeVisible()
  await expect(page.getByText(/Home · /)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Comments', exact: true })).toBeVisible()

  // the stamp is per user and server-side, so it survives a reload — the dot
  // used to have nowhere to be remembered at all
  await page.reload()
  await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Comments', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /unread/ })).toHaveCount(0)
})
