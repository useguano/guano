import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The parts of the editor that were unusable without a mouse.
//
// Not a full audit — the wider ARIA work on the select, menu, stepper and the
// layers tree is a separate pass. These are the ones that BLOCK: a dialog
// nothing announced, with focus left on the page behind it so Tab walked
// controls hidden under a scrim; an icon-only close button with no name at
// all; and a save status that changed colour and said nothing.
//
// Named to sort AFTER smoke.spec, which owns the first-run flow.

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

test('a modal is a dialog: named, announced, and it keeps focus', async ({ page }) => {
  await openEditor(page)

  // the media library is a modal reachable from the rail
  await page.getByRole('button', { name: /Media/i }).first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')

  // focus moved in. It used to stay on whatever was behind, so Tab walked the
  // page under the scrim: reachable, invisible, unclickable.
  await expect
    .poll(async () => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true)

  // ...and stays in: tabbing right round the dialog never leaves it
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      `focus escaped the dialog after ${i + 1} tabs`,
    ).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the save status is announced, not only coloured', async ({ page }) => {
  await openEditor(page)
  const status = page.locator('aside button[aria-live]').first()
  await expect(status).toHaveAttribute('aria-live', 'polite')
  await expect(status).toHaveAttribute('aria-label', /sav/i)
})

test('a titled dialog is named by its own header, with a named close', async ({ page }) => {
  await openEditor(page)

  // Create collection is a titled dialog, reached from the Pages drawer
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'New collection' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  // named by its own heading, so a screen reader says WHICH dialog opened
  const labelledBy = await dialog.getAttribute('aria-labelledby')
  expect(labelledBy, 'a titled dialog points at its heading').toBeTruthy()
  const heading = page.locator(`[id="${labelledBy}"]`)
  await expect(heading).toHaveText('Create collection')

  // the close button is an icon with no text; ButtonUI takes an icon-only
  // button's accessible name from its tooltip, and this one had none
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
