import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// Autosave against a second writer.
//
// The store holds ONE whole-project blob per branch and is latest-wins, so
// every save is a chance to erase everything another writer did. The editor
// guards that with merge-on-save against a baseline — but two paths skipped
// it, and both are here.
//
// Browser-level on purpose: all of this lives in the editor, and the server
// half (If-Match, the per-key lock) is covered by store-concurrency.spec.ts.
//
// Named to sort AFTER smoke.spec, which owns the first-run flow.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const MAIN = 'guano-project:main'

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
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Retitle the hero in place.
 *
 * `dispatchEvent` rather than a pointer dblclick: a decorative layer sits over
 * the heading and would intercept a real one. Enter COMMITS — on the Edit
 * canvas Escape discards, which is the opposite of the Play surface.
 */
async function retitle(page: Page, text: string) {
  const hero = page.locator('h1').first()
  await expect(hero).toBeVisible({ timeout: 30_000 })
  await hero.dispatchEvent('dblclick')
  const editing = page.locator('span[contenteditable]')
  await expect(editing).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await expect(page.locator('h1', { hasText: text }).first()).toBeVisible()
}

/** the stored blob for a key, parsed */
async function stored(page: Page, key: string) {
  const raw = await page.evaluate(async (k) => {
    const res = await fetch(`/api/store?keys=${encodeURIComponent(k)}`)
    return ((await res.json()) as Record<string, string | null>)[k] ?? null
  }, key)
  return raw ? (JSON.parse(raw) as Record<string, any>) : null
}

/** write the blob back with one extra page, as a second writer would */
async function writeAsSomeoneElse(page: Page, key: string, pageName: string) {
  await page.evaluate(
    async ([k, name]) => {
      const res = await fetch(`/api/store?keys=${encodeURIComponent(k!)}`)
      const blob = JSON.parse(((await res.json()) as Record<string, string>)[k!]!)
      blob.pages.push({
        id: `elsewhere-${name}`,
        name,
        path: `/${name}`,
        status: 'draft',
        elements: [{ id: `body-${name}`, type: 'body', content: '', children: [] }],
      })
      await fetch(`/api/store/${encodeURIComponent(k!)}`, {
        method: 'PUT',
        body: JSON.stringify(blob),
      })
    },
    [key, pageName],
  )
}

/**
 * Wait until the SERVER holds what we are waiting for.
 *
 * Polling the stored blob rather than the save pill: the pill is one render of
 * a status, while this is the thing every assertion below is actually about.
 */
async function waitForStored(page: Page, key: string, want: (blob: any) => boolean) {
  await expect
    .poll(async () => want((await stored(page, key)) ?? {}), { timeout: 20_000 })
    .toBe(true)
  // the debounce plus its flush, so nothing is still on its way out
  await page.waitForTimeout(900)
}

/** every key the editor keeps a project under, newest branch meta first */
async function draftKey(page: Page) {
  const meta = await stored(page, 'guano-branches')
  const id = meta?.branches?.at(-1)?.id
  return id ? `guano-project:${id}` : null
}

test('undo does not revert what another writer changed', async ({ page }) => {
  await openEditor(page)

  // an edit of our own, settled, so this tab has a baseline
  const FIRST = `Mine ${Date.now()}`
  await retitle(page, FIRST)
  await waitForStored(page, MAIN, (b) => JSON.stringify(b).includes(FIRST))

  // ...then someone else adds a page: another session, or an agent
  await writeAsSomeoneElse(page, MAIN, 'theirs')
  const hasTheirs = (b: any) => (b.pages ?? []).some((p: any) => p.name === 'theirs')
  expect(hasTheirs((await stored(page, MAIN))!)).toBe(true)

  // One undo. It used to write this tab's whole previous snapshot with no
  // re-read, so their page vanished — while the save pill said Saved. The
  // guarantee is about the write the undo makes, not about how far back the
  // history goes: walking further would legitimately reach states that predate
  // their page.
  await page.keyboard.press('ControlOrMeta+z')
  await page.waitForTimeout(2500) // the debounce, the merge round trip, the write

  expect(
    hasTheirs((await stored(page, MAIN))!),
    'the other writer’s page survived the undo',
  ).toBe(true)
})

test('an undo that merges does not cost the redo', async ({ page }) => {
  await openEditor(page)

  const MARK = `Mine ${Date.now()}`
  await retitle(page, MARK)
  await waitForStored(page, MAIN, (b) => JSON.stringify(b).includes(MARK))
  await writeAsSomeoneElse(page, MAIN, 'elsewhere')

  // Undo until the heading actually changes: one inline edit leaves TWO
  // history entries whose rendered text is identical, so the first press looks
  // like a no-op. Pre-existing, and unrelated to what is under test here.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ControlOrMeta+z')
    await page.waitForTimeout(500)
    if ((await page.locator('h1', { hasText: MARK }).count()) === 0) break
  }
  await expect(page.locator('h1', { hasText: MARK })).toHaveCount(0)

  // Merging during an undo used to PUSH the merged state while the pointer had
  // already moved back, which truncated the redo arm: ⌘⇧Z had nothing to
  // return to. It replaces the entry in place instead.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await page.waitForTimeout(500)
    if ((await page.locator('h1', { hasText: MARK }).count()) > 0) break
  }
  await expect(page.locator('h1', { hasText: MARK }).first()).toBeVisible()
})

test('switching drafts mid-edit writes each branch to its own key', async ({ page }) => {
  await openEditor(page)
  const ON_MAIN = `Main ${Date.now()}`
  await retitle(page, ON_MAIN)
  await waitForStored(page, MAIN, (b) => JSON.stringify(b).includes(ON_MAIN))

  // a draft of our own, from the Drafts panel
  await page.getByRole('button', { name: 'Drafts' }).click()
  await page.getByRole('button', { name: 'New draft' }).click()
  await page.getByPlaceholder('Draft name').fill('Side quest')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Editing “Side quest”')).toBeVisible({ timeout: 15_000 })

  const draft = await draftKey(page)
  expect(draft, 'the draft got its own project key').toBeTruthy()

  // type into the draft, then switch away WITHOUT waiting for the debounce, so
  // the save is still in flight across the branch change
  const IN_DRAFT = `Draft ${Date.now()}`
  await retitle(page, IN_DRAFT)
  await page.getByRole('button', { name: 'Back to Main' }).click()
  await expect(page.getByText('You’re on Main')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)

  // The in-flight save captured the draft's key before the switch but read the
  // ACTIVE key back after it, so it wrote the draft's bytes under whichever
  // branch was open by then: the branch you just opened, overwritten with the
  // one you left.
  const main = JSON.stringify(await stored(page, MAIN))
  expect(main, 'the draft’s text must not reach Main').not.toContain(IN_DRAFT)
  expect(main, 'Main still says what it said').toContain(ON_MAIN)

  // ...and the draft kept the edit
  const draftBlob = JSON.stringify(await stored(page, draft!))
  expect(draftBlob, 'the draft kept its own edit').toContain(IN_DRAFT)
})

/**
 * A refusal the server took care to name reaches the user.
 *
 * The store threw on `!res.ok` without reading the body, so every refusal —
 * 'project storage is full', the contributor structural rejection, the 412
 * re-read instruction — arrived as "save failed (403)". And there was no
 * surface to show it on: a failed save was a colour on a pill inside a
 * popover, and an uncaught render error was nothing at all.
 */
test('a rejected save says what the server said, and offers no pointless retry', async ({
  page,
}) => {
  await openEditor(page)

  // a refusal with a message, in the shape the server sends
  await page.route('**/api/store/guano-project%3Amain', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'custom code is not yours to change' }),
    })
  })

  await retitle(page, `Refused ${Date.now()}`)

  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 15_000 })
  await expect(alert).toContainText('custom code is not yours to change')
  // terminal: the same request will be refused forever, so there is no Retry
  await expect(alert.getByRole('button', { name: 'Retry' })).toHaveCount(0)

  // and it is announced, not just drawn
  await expect(page.getByRole('region', { name: 'Notifications' })).toHaveAttribute(
    'aria-live',
    'assertive',
  )

  // a 5xx is the other half: worth trying again, so it offers to
  await page.unroute('**/api/store/guano-project%3Amain')
  await page.route('**/api/store/guano-project%3Amain', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"busy"}' })
  })
  await retitle(page, `Retryable ${Date.now()}`)
  await expect(page.getByRole('alert').getByRole('button', { name: 'Retry' })).toBeVisible({
    timeout: 15_000,
  })
})
