import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// Authoring a form end to end in the real editor: insert it, turn on Accept
// submissions in the DATA panel, add a success block, publish, and watch a real
// submission arrive in the submissions modal.
//
// The two things only a browser reaches: the Data panel writes a config that
// survives to the published site, and the submissions an endpoint stored show
// up in the editor as TEXT. Everything else — the refusal order, the CORS rule,
// the CSV — is pinned at the API level in store-forms.spec.
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

/** publish, waiting out the server's 12/min guard rather than relaxing it */
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

test('a form is turned on in the Data panel, and a real submission reaches the editor', async ({
  page,
  baseURL,
}) => {
  await openEditor(page)

  // The fixture's Home page already has a signup form, which is the one to use:
  // inserting a second one and then addressing "the first row matching form"
  // configures one and asserts on the other.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  const pageRow = page.locator('[data-page-row="Home"]')
  await pageRow.hover()
  await pageRow.getByRole('button', { name: 'Edit layers' }).click()

  const formRow = page.locator('[data-layer-row]').filter({ hasText: 'form' }).first()
  await expect(formRow).toBeVisible({ timeout: 15_000 })

  // --- the Data panel: turn it on and add the success state ---
  await formRow.click()
  await page.keyboard.press('d')
  const formGroup = page.getByText('Form', { exact: true }).first()
  await expect(formGroup).toBeVisible({ timeout: 15_000 })

  // off by default: the hint says so rather than the form silently doing nothing
  await expect(page.getByText(/posts nowhere/i)).toBeVisible()
  await page.getByText('Accept submissions').locator('..').getByRole('switch').click()
  // now the rest of the controls appear
  await expect(page.getByText('Email me')).toBeVisible({ timeout: 10_000 })
  // and the panel reports what will actually be submitted — the fixture's
  // input has no `name`, so this is the "it would arrive empty" hint
  await expect(page.getByText(/no named fields yet/i)).toBeVisible()

  await page.getByRole('button', { name: 'Success', exact: true }).click()
  const successRow = page.locator('[data-layer-row]').filter({ hasText: 'form-success' }).first()
  await expect(successRow).toBeVisible({ timeout: 15_000 })

  // --- name the input through the Data panel's attributes, then publish ---
  // (done over the API: the attribute rows are covered by their own spec, and
  // this spec is about the form config and the submissions view)
  interface Node {
    id: string
    type: string
    attributes?: Record<string, string>
    form?: { enabled?: boolean }
    children?: Node[]
  }
  const findForm = async (): Promise<{ project: { pages: { elements: Node[] }[] }; form: Node | null }> => {
    const stored = await (await page.request.get('/api/store?keys=guano-project:main')).json()
    const project = JSON.parse(stored['guano-project:main']) as { pages: { elements: Node[] }[] }
    // the FIRST form on the FIRST page: the same node the Layers row above
    // addressed. Taking the last form found anywhere read a different node.
    const first = (nodes: Node[]): Node | null => {
      for (const n of nodes) {
        if (n.type === 'form') return n
        const hit = first(n.children ?? [])
        if (hit) return hit
      }
      return null
    }
    return { project, form: first(project.pages[0]!.elements) }
  }

  // autosave is debounced 500ms by design, so poll rather than read once —
  // and this IS the assertion: the Data panel's toggle has to reach the store
  await expect
    .poll(async () => (await findForm()).form?.form?.enabled, { timeout: 15_000 })
    .toBe(true)

  const { project, form: formNode } = await findForm()
  expect(formNode).not.toBeNull()
  const form = formNode as unknown as Node
  // the control is nested (label + div wrapper), so search the subtree rather
  // than the form's direct children
  const findInput = (nodes: Node[]): Node | null => {
    for (const n of nodes) {
      if (n.type === 'input') return n
      const hit = findInput(n.children ?? [])
      if (hit) return hit
    }
    return null
  }
  const input = findInput(form.children ?? [])
  expect(input).toBeTruthy()
  input!.attributes = { ...(input!.attributes ?? {}), name: 'email', type: 'email' }
  expect(
    (await page.request.put('/api/store/guano-project%3Amain', { data: project })).ok(),
  ).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await publish(page)
  // the publish dialog stays up; its overlay swallows every later click
  await page.keyboard.press('Escape')
  await expect(page.getByText('Published!')).toBeHidden({ timeout: 15_000 })

  // --- the published page carries the endpoint and the hidden state block ---
  const html = await (await page.request.get('/')).text()
  expect(html).toContain(`action="/_guano/forms/${form.id}"`)
  expect(html).toContain('name="_hp"')
  expect(html).toContain('data-form-success hidden')

  // --- a real visitor submits ---
  const res = await page.request.post(`/_guano/forms/${form.id}`, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'x-forwarded-for': '203.0.113.250',
    },
    data: new URLSearchParams({ email: 'ui@example.com', _route: '/', _t: '5000' }).toString(),
  })
  expect(res.status()).toBe(200)

  // --- and it shows up in the editor, as text ---
  // the reload above closed the panel and cleared the selection, so re-open
  // the form's Data panel to reach its submissions entry point
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await pageRow.hover()
  await pageRow.getByRole('button', { name: 'Edit layers' }).click()
  const formRowAgain = page.locator('[data-layer-row]').filter({ hasText: 'form' }).first()
  await expect(formRowAgain).toBeVisible({ timeout: 15_000 })
  await formRowAgain.click()
  await page.keyboard.press('d')
  await page.getByRole('button', { name: 'View submissions' }).click()
  const modal = page.getByText('Form submissions')
  await expect(modal).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('ui@example.com')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/1 submission/)).toBeVisible()
})
