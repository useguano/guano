import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// FINDINGS S2: contributors must not be able to DELETE store keys (the PUT
// guard already blocks customCode/smtp changes). API-level spec — runs on the
// same isolated server as the rest of the suite and bootstraps its own users,
// so it does not depend on spec ordering.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const CONTRIB = { email: 'contrib@example.com', password: 'contrib-pass-1' }
const PROJECT_KEY = 'guano-project:main'

async function login(ctx: APIRequestContext, creds: { email: string; password: string }) {
  return ctx.post('/api/auth/login', { data: creds })
}

test('contributor store permissions: PUT unchanged ok, sensitive PUT and DELETE 403', async ({
  baseURL,
}) => {
  // --- admin session (create the first admin if this spec runs first) ---
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin, ADMIN)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  // --- ensure a project blob exists for the guard's stored baseline ---
  let projectBody: string
  const existing = await admin.get(`/api/store?keys=${PROJECT_KEY}`)
  const stored = (await existing.json()) as Record<string, string>
  if (stored[PROJECT_KEY]) {
    projectBody = stored[PROJECT_KEY]
  } else {
    projectBody = JSON.stringify({ name: 'Roles Co', pages: [], settings: {} })
    res = await admin.put(`/api/store/${PROJECT_KEY}`, { data: projectBody })
    expect(res.ok()).toBeTruthy()
  }

  // --- invite + accept a contributor ---
  res = await admin.post('/api/users/invite', {
    data: { name: 'Contrib', email: CONTRIB.email, role: 'contributor' },
  })
  let contribCtx: APIRequestContext
  if (res.ok()) {
    const { token } = await res.json()
    contribCtx = await pwRequest.newContext({ baseURL })
    res = await contribCtx.post(`/api/invite/${token}/accept`, {
      data: { password: CONTRIB.password },
    })
    expect(res.ok()).toBeTruthy()
  } else {
    // already invited+accepted on a previous run against the same data dir
    contribCtx = await pwRequest.newContext({ baseURL })
    res = await login(contribCtx, CONTRIB)
    expect(res.ok()).toBeTruthy()
  }

  // --- contributor autosave shape: PUT with sensitive fields unchanged → ok ---
  res = await contribCtx.put(`/api/store/${PROJECT_KEY}`, { data: projectBody })
  expect(res.status()).toBe(200)

  // --- contributor PUT that alters customCode → 403 (existing guard) ---
  const tampered = JSON.parse(projectBody)
  tampered.settings = { ...(tampered.settings ?? {}), customCode: { head: '<script>evil()</script>' } }
  res = await contribCtx.put(`/api/store/${PROJECT_KEY}`, { data: JSON.stringify(tampered) })
  expect(res.status()).toBe(403)

  // --- contributor DELETE of any store key → 403 (S2 fix) ---
  res = await contribCtx.delete(`/api/store/${PROJECT_KEY}`)
  expect(res.status()).toBe(403)
  res = await contribCtx.delete('/api/store/guano-branches')
  expect(res.status()).toBe(403)

  // --- the project blob is still there, and admins can still delete keys ---
  const after = (await (await admin.get(`/api/store?keys=${PROJECT_KEY}`)).json()) as Record<
    string,
    string
  >
  expect(after[PROJECT_KEY]).toBeTruthy()
  // a draft key, because the store now refuses a key outside the product's
  // own set — see 'the draft index is not a way to take over someone's draft'
  res = await admin.put('/api/store/guano-project:scratch-role-spec', { data: '{"pages":[]}' })
  expect(res.ok()).toBeTruthy()
  res = await admin.delete('/api/store/guano-project:scratch-role-spec')
  expect(res.status()).toBe(200)

  // and an invented key is refused for an admin too
  expect((await admin.put('/api/store/scratch-role-spec', { data: '{"x":1}' })).status()).toBe(400)

  await admin.dispose()
  await contribCtx.dispose()
})

/**
 * The draft index is not a way to take over someone else's draft.
 *
 * `ownsDraft` — the gate on DELETE — reads `createdBy` out of the
 * `guano-branches` blob. That blob was not a project key, so the store's
 * server-authoritative content merge did not apply to it and a contributor's
 * PUT was written verbatim. So the sequence below used to work end to end:
 * rewrite the index with your own id stamped on an admin's draft, then delete
 * the draft. The refusal is named rather than silently reverted, because a
 * silent revert reads as success and nobody learns something tried.
 */
test("the draft index is not a way to take over someone's draft", async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin, ADMIN)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  const contribCtx = await pwRequest.newContext({ baseURL })
  if (!(await login(contribCtx, CONTRIB)).ok()) {
    const invite = await admin.post('/api/users/invite', {
      data: { email: CONTRIB.email, role: 'contributor' },
    })
    expect(invite.ok()).toBeTruthy()
    const { token } = (await invite.json()) as { token: string }
    expect(
      (
        await contribCtx.post(`/api/invite/${token}/accept`, {
          data: { name: 'Contrib', password: CONTRIB.password },
        })
      ).ok(),
    ).toBeTruthy()
  }

  const me = (await (await admin.get('/api/auth/me')).json()) as { id: string }
  const KEY = 'guano-branches'
  const DRAFT = 'guano-project:admins-draft'

  // an admin's draft, stamped with the admin's id, and a real blob behind it
  expect((await admin.put(`/api/store/${DRAFT}`, { data: '{"pages":[]}' })).ok()).toBeTruthy()
  const index = {
    activeId: 'main',
    branches: [
      { id: 'admins-draft', name: "Admin's draft", createdAt: Date.now(), createdBy: me.id },
    ],
  }
  expect((await admin.put(`/api/store/${KEY}`, { data: JSON.stringify(index) })).ok()).toBeTruthy()

  // the contributor cannot restamp it...
  const stolen = {
    activeId: 'main',
    branches: [{ ...index.branches[0]!, createdBy: 'me-now' }],
  }
  let bad = await contribCtx.put(`/api/store/${KEY}`, { data: JSON.stringify(stolen) })
  expect(bad.status()).toBe(403)
  expect(await bad.text()).toContain("do not own")

  // ...nor drop it from the index
  bad = await contribCtx.put(`/api/store/${KEY}`, {
    data: JSON.stringify({ activeId: 'main', branches: [] }),
  })
  expect(bad.status()).toBe(403)

  // ...nor rename it
  bad = await contribCtx.put(`/api/store/${KEY}`, {
    data: JSON.stringify({ activeId: 'main', branches: [{ ...index.branches[0]!, name: 'Mine' }] }),
  })
  expect(bad.status()).toBe(403)

  // so the draft is still the admin's, and still undeletable by them
  expect((await contribCtx.delete(`/api/store/${DRAFT}`)).status()).toBe(403)

  // what they CAN do: add their own draft, which is stamped as theirs
  // whatever the body claims
  const own = {
    activeId: 'main',
    branches: [
      index.branches[0]!,
      { id: 'contrib-draft', name: 'Mine', createdAt: Date.now(), createdBy: 'not-me' },
    ],
  }
  expect((await contribCtx.put(`/api/store/${KEY}`, { data: JSON.stringify(own) })).ok()).toBeTruthy()
  const back = JSON.parse(
    ((await (await admin.get(`/api/store?keys=${KEY}`)).json()) as Record<string, string>)[KEY]!,
  )
  const mine = back.branches.find((b: any) => b.id === 'contrib-draft')
  expect(mine.createdBy).not.toBe('not-me')
  expect(back.branches.find((b: any) => b.id === 'admins-draft').createdBy).toBe(me.id)

  // and discard the one they own. The draft blob is a snapshot of Main, which
  // is what createBranch sends — a contributor's project write goes through
  // the content merge, so an empty blob is not a draft they could have made.
  const main = ((await (await admin.get(`/api/store?keys=${PROJECT_KEY}`)).json()) as Record<
    string,
    string
  >)[PROJECT_KEY]!
  expect(
    (await contribCtx.put('/api/store/guano-project:contrib-draft', { data: main })).ok(),
  ).toBeTruthy()
  expect((await contribCtx.delete('/api/store/guano-project:contrib-draft')).status()).toBe(200)

  await admin.delete(`/api/store/${DRAFT}`)
  await admin.dispose()
  await contribCtx.dispose()
})

/**
 * Publishing secrets and the visitor password are admin-only.
 *
 * Both routes refused contributors and let editors through, while the comment
 * on the agent-policy route claimed all three followed the admin rule. The
 * GitHub token is the credential the server signs every push with, so an
 * editor who could replace it could point the operator's PAT at a repository
 * of their own; the site password is the one credential shared with visitors,
 * and changing it signs every one of them out.
 */
test('publishing secrets and the site password are admin-only', async ({ baseURL }) => {
  const EDITOR = { email: 'editor-roles@example.com', password: 'editor-pass-1' }
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin, ADMIN)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  const editor = await pwRequest.newContext({ baseURL })
  if (!(await login(editor, EDITOR)).ok()) {
    const invite = await admin.post('/api/users/invite', {
      data: { email: EDITOR.email, role: 'editor' },
    })
    expect(invite.ok()).toBeTruthy()
    const { token } = (await invite.json()) as { token: string }
    expect(
      (
        await editor.post(`/api/invite/${token}/accept`, {
          data: { name: 'Editor', password: EDITOR.password },
        })
      ).ok(),
    ).toBeTruthy()
  }
  expect(((await (await editor.get('/api/auth/me')).json()) as { role: string }).role).toBe('editor')

  // an editor may still READ both: the responses are booleans the Publish and
  // General panels need — whether a token is set, whether the gate is on — and
  // neither carries a secret
  expect((await editor.get('/api/publish-config')).status()).toBe(200)
  expect(await (await editor.get('/api/publish-config')).json()).toMatchObject({
    github: { tokenSet: expect.any(Boolean) },
  })
  expect((await editor.get('/api/site-password')).status()).toBe(200)

  // a contributor reads neither
  const contrib = await pwRequest.newContext({ baseURL })
  if ((await login(contrib, CONTRIB)).ok()) {
    expect((await contrib.get('/api/publish-config')).status()).toBe(403)
    expect((await contrib.get('/api/site-password')).status()).toBe(403)
  }
  await contrib.dispose()

  // ...and may change neither
  let bad = await editor.put('/api/publish-config', { data: { github: { token: 'ghp_theirs' } } })
  expect(bad.status()).toBe(403)
  expect(await bad.text()).toContain('admin')

  bad = await editor.put('/api/site-password', { data: { enabled: true, password: 'theirs12' } })
  expect(bad.status()).toBe(403)
  expect(await bad.text()).toContain('admin')

  // the admin still can, and the site is left as it was
  expect((await admin.get('/api/publish-config')).status()).toBe(200)
  expect(
    (await admin.put('/api/site-password', { data: { enabled: false, password: '' } })).status(),
  ).toBe(200)

  await admin.dispose()
  await editor.dispose()
})
