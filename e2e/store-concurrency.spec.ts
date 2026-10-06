import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import { createHash } from 'node:crypto'

// The server half of the lost-update fix (Vezaro, MAJOR: a saved page silently
// back at an earlier version, with every call reporting success).
//
// A whole project blob goes out on every write, so a write that lands on top of
// another writer's does not lose a field — it loses every page that writer had.
// `If-Match` lets a client say which bytes it read, and the per-key lock is
// what makes the check mean anything: without it the read, the checks and the
// write of two requests interleave freely, and both can pass a comparison
// against bytes the other has already replaced.
//
// API-level and self-bootstrapping like store-roles.spec, and named to sort
// AFTER smoke.spec, which owns the first-run flow.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const KEY = 'guano-project:cas-spec-draft'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

async function adminContext(baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL })
  const res = await ctx.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    expect(
      (await ctx.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })).ok(),
    ).toBeTruthy()
  }
  return ctx
}

const blob = (mark: string) =>
  JSON.stringify({
    name: mark,
    pages: [{ id: 'home', name: 'Home', path: '/', status: 'published', elements: [] }],
  })

async function read(ctx: APIRequestContext, key: string) {
  const map = (await (await ctx.get(`/api/store?keys=${key}`)).json()) as Record<string, string>
  return map[key] ?? null
}

test('a store write names the bytes it read, and is refused when they moved', async ({
  baseURL,
}) => {
  const admin = await adminContext(baseURL)
  expect((await admin.put(`/api/store/${KEY}`, { data: blob('first') })).ok()).toBeTruthy()
  const stored = (await read(admin, KEY))!

  // the wrong baseline: refused with the hash the caller should have had, so
  // it can re-read and reapply rather than guess what happened
  const stale = await admin.put(`/api/store/${KEY}`, {
    data: blob('built on older bytes'),
    headers: { 'if-match': sha256(blob('something else')) },
  })
  expect(stale.status()).toBe(412)
  expect((await stale.json()).currentHash).toBe(sha256(stored))
  expect(JSON.parse((await read(admin, KEY))!).name).toBe('first')

  // the right baseline goes through
  const fresh = await admin.put(`/api/store/${KEY}`, {
    data: blob('second'),
    headers: { 'if-match': sha256(stored) },
  })
  expect(fresh.ok()).toBeTruthy()
  expect(JSON.parse((await read(admin, KEY))!).name).toBe('second')

  // and a client that sends no header keeps the editor's last-writer-wins
  // autosave, which is what the browser has always done
  expect((await admin.put(`/api/store/${KEY}`, { data: blob('third') })).ok()).toBeTruthy()
  expect(JSON.parse((await read(admin, KEY))!).name).toBe('third')

  await admin.delete(`/api/store/${KEY}`)
  await admin.dispose()
})

test('of eight writes claiming one baseline, exactly one lands', async ({ baseURL }) => {
  const admin = await adminContext(baseURL)
  expect((await admin.put(`/api/store/${KEY}`, { data: blob('base') })).ok()).toBeTruthy()
  const baseline = sha256((await read(admin, KEY))!)

  // One context per writer, deliberately: a single APIRequestContext sends its
  // requests down one connection, so eight calls through it arrive one at a
  // time and would prove nothing about what happens when they do not. A token
  // per socket is what two agents, or an agent and an editor, actually look
  // like to the server.
  const { token } = await (await admin.post('/api/tokens', { data: { name: 'cas-spec' } })).json()
  const writers = await Promise.all(
    Array.from({ length: 8 }, () =>
      pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } }),
    ),
  )

  // every writer read the same bytes, so all but one is building on a version
  // that will not exist by the time it writes. In the gaps between the read,
  // the checks and the write, more than one used to get through.
  const results = await Promise.all(
    writers.map((w, i) =>
      w.put(`/api/store/${KEY}`, {
        data: blob(`writer ${i}`),
        headers: { 'if-match': baseline },
      }),
    ),
  )
  expect(results.filter((r) => r.ok())).toHaveLength(1)
  expect(results.filter((r) => r.status() === 412)).toHaveLength(7)

  // and the stored value is that one writer's, whole
  expect(JSON.parse((await read(admin, KEY))!).name).toMatch(/^writer \d$/)

  for (const w of writers) await w.dispose()
  await admin.delete(`/api/store/${KEY}`)
  await admin.dispose()
})
