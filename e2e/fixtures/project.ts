import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * The suite's content fixture: "Brume", a one-page marketing site with a post
 * collection, two shared components, a shared interaction library, design
 * tokens and en/fr locales — enough surface for every UI spec to start from.
 *
 * It is test data and nothing else. It used to ship in the SPA and load through
 * an `/admin?demo` URL; now it lives here and is written straight to the store,
 * so no test hook exists in the product. `project.json` is edited by hand (or
 * by loading it in the editor and copying the stored blob back).
 */
const FIXTURE = readFileSync(new URL('./project.json', import.meta.url), 'utf8')

/**
 * Replace Main with the fixture and open the editor on it. The page must be
 * logged in already. It leaves the SPA first: an editor still open on the
 * previous project could autosave over the seed.
 */
export async function loadFixture(page: Page) {
  await page.goto('about:blank')
  const res = await page.request.put('/api/store/guano-project%3Amain', { data: FIXTURE })
  if (!res.ok()) throw new Error(`could not seed the fixture project (${res.status()})`)
  await page.goto('/admin/')
}
