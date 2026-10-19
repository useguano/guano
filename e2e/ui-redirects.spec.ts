import { test, expect, type Page } from '@playwright/test'
import { openEditor } from './fixtures/session'

// The two prompts that make 301s a feature rather than a settings list nobody
// opens: changing a page's slug offers the redirect, and a path that is
// already a redirect source says so.
//
// Nobody goes looking for a redirects panel after a rename — the moment the
// old path stops answering is the only moment anyone knows it existed, and it
// is the moment the editor is already showing you. The panel is where they are
// corrected afterwards; the offer is where they come from.
//
// Named to sort AFTER smoke.spec (it logs in; see ui-entry-editor).



/** the Pages drawer row for a page, by name */
const pageRow = (page: Page, name: string) => page.locator(`[data-page-row="${name}"]`)

/** open a page's settings view through the row's kebab */
async function openPageSettings(page: Page, name: string) {
  const row = pageRow(page, name)
  await expect(row).toBeVisible()
  await row.hover()
  await row.getByRole('button').last().click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Page settings')).toBeVisible()
}

/**
 * A page to rename. The fixture's only plain page is Home, whose slug is the
 * site root and fixed; its other page is a collection TEMPLATE, which the
 * drawer lists under the collection and whose routes come from the collection
 * anyway. So the spec makes one: "Page 2" at /page-2.
 */
async function newPage(page: Page) {
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'New page' }).click()
  await expect(pageRow(page, 'Page 2')).toBeVisible()
}

const slugInput = (page: Page) => page.locator('input[placeholder="/path"]')

test('changing a slug offers a 301, and the offer writes it', async ({ page }) => {
  await openEditor(page)
  await newPage(page)
  await openPageSettings(page, 'Page 2')

  const slug = slugInput(page)
  await expect(slug).toHaveValue('/page-2')
  await slug.fill('/blog')
  await slug.blur()

  // the alert names the path that stops answering — the thing other people's
  // links point at, which is the whole reason to ask
  await expect(page.getByText('/page-2', { exact: true })).toBeVisible()
  await expect(page.getByText('will break')).toBeVisible()
  await page.getByRole('button', { name: 'Add 301 redirect' }).click()

  // offered once: it is answered, so it stops asking
  await expect(page.getByRole('button', { name: 'Add 301 redirect' })).toBeHidden()

  // and it is in the project, where it can be corrected later
  await page.getByRole('button', { name: 'Project settings' }).click()
  await page.getByRole('button', { name: 'Redirects' }).click()
  // the panel's two inputs, by their placeholders — `value` is a property here,
  // not an attribute, so toHaveValue is the only honest read
  await expect(page.locator('input[placeholder="/old-pricing"]')).toHaveValue('/page-2')
  await expect(page.locator('input[placeholder="/pricing"]')).toHaveValue('/blog')
})

test('a slug that is already a redirect source says so, and can take it over', async ({ page }) => {
  await openEditor(page)
  await newPage(page)

  // a rename, accepted — so /page-2 now redirects to /blog
  await openPageSettings(page, 'Page 2')
  const slug = slugInput(page)
  await slug.fill('/blog')
  await slug.blur()
  await page.getByRole('button', { name: 'Add 301 redirect' }).click()

  // now move it BACK onto the path that redirects. The page wins either way
  // (the export drops a rule a route shadows), so the question is only whether
  // to keep carrying a rule that does nothing.
  await slug.fill('/page-2')
  await slug.blur()
  await expect(page.getByText('This path already redirects to')).toBeVisible()
  await page.getByRole('button', { name: 'Remove redirect' }).click()
  await expect(page.getByText('This path already redirects to')).toBeHidden()

  await page.getByRole('button', { name: 'Project settings' }).click()
  await page.getByRole('button', { name: 'Redirects' }).click()
  await expect(page.getByText('No redirects.')).toBeVisible()
})

test('the panel refuses a redirect that cannot work, and flags one a page shadows', async ({
  page,
}) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Project settings' }).click()
  await page.getByRole('button', { name: 'Redirects' }).click()
  await page.getByRole('button', { name: 'Add redirect' }).click()

  const from = page.locator('input[placeholder="/old-pricing"]')
  const to = page.locator('input[placeholder="/pricing"]')

  // the home page cannot redirect away — it is the site root
  await from.fill('/')
  await to.fill('/elsewhere')
  await expect(page.getByText('the home page cannot redirect away')).toBeVisible()

  // a destination nothing publishes is allowed but reported: a 301 into a 404
  // is worse than no redirect
  await from.fill('/old')
  await expect(page.getByText(/nothing is published at \/elsewhere/)).toBeVisible()

  // and a source a published page answers on is ignored, so say it here
  // rather than letting a publish look like it worked
  await from.fill('/journal')
  await to.fill('/blog')
  await expect(page.getByText(/is a published page, so the page wins/)).toBeVisible()
})
