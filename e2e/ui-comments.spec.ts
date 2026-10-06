import { test, expect, type Page } from '@playwright/test'
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
  const desktop = page.locator(`[data-breakpoint-id="${DESKTOP}"]`)
  await expect(tablet).toBeVisible()
  const frame = (await tablet.boundingBox())!
  const desktopBox = (await desktop.boundingBox())!

  // arm the tool and drop a pin inside the TABLET frame. Whatever node is
  // under the click (at minimum the page body) is rendered in all three
  // frames, which is exactly the ambiguity the anchor's breakpoint resolves.
  await page.keyboard.press('c')
  await expect(page.locator('.cursor-crosshair')).toHaveCount(1)
  const offset = { x: 24, y: 24 }
  await tablet.click({ position: offset })
  const clicked = { x: frame.x + offset.x, y: frame.y + offset.y }

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
  const pinBox = (await pin.boundingBox())!

  // the pin is drawn over the tablet frame, and nowhere near the desktop one
  const pinX = pinBox.x + pinBox.width / 2
  expect(pinX).toBeGreaterThan(frame.x)
  expect(pinX).toBeLessThan(frame.x + frame.width)
  expect(pinX < desktopBox.x || pinX > desktopBox.x + desktopBox.width).toBeTruthy()

  // and its tail — the bottom-left corner — sits on the point that was clicked
  expect(Math.abs(pinBox.x - clicked.x)).toBeLessThan(3)
  expect(Math.abs(pinBox.y + pinBox.height - clicked.y)).toBeLessThan(3)
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
