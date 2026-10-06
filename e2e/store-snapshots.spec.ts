import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'
import sharp from 'sharp'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
// the product's own zip codec, so the crafted package below is exactly the
// shape buildPackage used to produce
import { createZip, readZip } from '../server/zip.mjs'

// /api/snapshots: the project package (store + media) kept ON the server and
// listed, so a restore point is one click rather than a download kept
// somewhere safe. Restoring one is the import. Admin-only, like both.
//
// API-level spec: bootstraps its own admin like store-roles, so it does not
// depend on ordering beyond sorting after smoke.spec.ts.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

/**
 * A snapshot taken after a publish must restore.
 *
 * It did not. buildPackage walked the whole media dir, which includes the
 * exporter's `variants/` resize cache, while applyPackage's allowlist knew
 * only `media/files/*` and `media/thumbs/*` and answered anything else with
 * `unexpected entry`, failing the WHOLE restore. So any instance that had ever
 * published a project with a resizable raster had unrestorable backups, and
 * the error named a file the operator never created.
 *
 * This passed vacuously before: the shared fixture's only images are SVG data
 * URLs, and SVG is excluded from resizing, so `variants/` was always empty.
 * Hence the publish of a real PNG here.
 *
 * Both halves are asserted. New packages no longer carry the cache, and a
 * package that DOES carry it still imports — which is the half that matters
 * for the backups already sitting on people's disks.
 */
test('a snapshot survives a publish that filled the variant cache', async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await admin.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  const MAIN = 'guano-project:main'
  const raw = ((await (await admin.get(`/api/store?keys=${MAIN}`)).json()) as Record<string, string>)[MAIN]!
  const main = JSON.parse(raw)

  // a PNG wide enough that the exporter writes at least the 480/768 variants
  const png = await sharp({
    create: { width: 1400, height: 400, channels: 3, background: { r: 10, g: 90, b: 200 } },
  })
    .png()
    .toBuffer()
  const home = main.pages.find((p: any) => p.published !== false) ?? main.pages[0]
  const body = home.elements.find((n: any) => n.type === 'body')
  body.children.push({
    id: 'snapshot-raster',
    type: 'image',
    src: `data:image/png;base64,${png.toString('base64')}`,
    classes: 'w-full',
    children: [],
  })
  expect((await admin.put(`/api/store/${MAIN}`, { data: JSON.stringify(main) })).ok()).toBeTruthy()
  expect((await admin.post('/api/published', { data: JSON.stringify(main) })).ok()).toBeTruthy()

  // the cache the old package bundled and the old import rejected
  // the same dir playwright.config.ts hands the server, resolved from here
  const DATA_DIR = process.env.GUANO_DATA_DIR ?? resolve(import.meta.dirname, '..', '.e2e-data')
  const variantsDir = join(DATA_DIR, 'media', 'variants')
  expect(existsSync(variantsDir)).toBeTruthy()
  const cached = readdirSync(variantsDir).filter((f) => f.endsWith('.webp'))
  expect(cached.length).toBeGreaterThan(0)

  res = await admin.post('/api/snapshots')
  expect(res.ok()).toBeTruthy()
  const snap = (await res.json()) as { id: string }

  // half one: a new package leaves the derived cache out
  const zip = await (await admin.get(`/api/snapshots/${snap.id}`)).body()
  const entries = readZip(zip) as { path: string; data: Buffer }[]
  expect(entries.some((e) => e.path.startsWith('media/variants/'))).toBeFalsy()
  expect(entries.some((e) => e.path === 'manifest.json')).toBeTruthy()

  // and it restores
  expect((await admin.post(`/api/snapshots/${snap.id}/restore`)).ok()).toBeTruthy()

  // half two: a package that DOES carry the cache — every backup taken before
  // this fix — imports instead of being refused outright
  const legacy = createZip([
    ...entries,
    { path: `media/variants/${'a1b2c3d4e5f6'}-480.webp`, data: cached.length ? Buffer.from([0x52, 0x49]) : Buffer.alloc(2) },
  ])
  res = await admin.post('/api/project-import', {
    data: legacy,
    headers: { 'content-type': 'application/zip' },
  })
  expect(res.status(), await res.text()).toBe(200)

  // and an entry outside store/ and media/ is still refused outright — the
  // skip rule above must not have widened into "accept anything"
  const hostile = createZip([...entries, { path: 'users.json', data: Buffer.from('[]') }])
  res = await admin.post('/api/project-import', {
    data: hostile,
    headers: { 'content-type': 'application/zip' },
  })
  expect(res.status()).toBe(400)
  expect(await res.text()).toContain('unexpected entry')

  expect((await admin.delete(`/api/snapshots/${snap.id}`)).ok()).toBeTruthy()
})

test('a snapshot is taken, listed, downloadable, restorable and deletable', async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await admin.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  // the store reads as {key: rawJsonString}; writes take the raw string
  const MAIN = 'guano-project:main'
  const readMain = async () =>
    JSON.parse(((await (await admin.get(`/api/store?keys=${MAIN}`)).json()) as Record<string, string>)[MAIN]!)

  // what Main says now, so a restore can be proven to bring it back
  const main = await readMain()
  expect(Array.isArray(main.pages)).toBeTruthy()

  res = await admin.post('/api/snapshots')
  expect(res.ok()).toBeTruthy()
  const snap = (await res.json()) as { id: string; createdAt: number; bytes: number }
  expect(snap.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/)
  expect(snap.bytes).toBeGreaterThan(0)

  const list = (await (await admin.get('/api/snapshots')).json()) as { id: string; bytes: number }[]
  expect(list.map((s) => s.id)).toContain(snap.id)

  // a name is a sidecar: it shows in the list and goes away with the snapshot
  res = await admin.patch(`/api/snapshots/${snap.id}`, { data: { name: '  Before redesign  ' } })
  expect(res.ok()).toBeTruthy()
  const named = (await (await admin.get('/api/snapshots')).json()) as { id: string; name: string }[]
  expect(named.find((s) => s.id === snap.id)?.name).toBe('Before redesign')

  // the download is the package zip itself
  res = await admin.get(`/api/snapshots/${snap.id}`)
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-type']).toContain('application/zip')
  expect((await res.body()).subarray(0, 2).toString()).toBe('PK')

  // change Main, then restore: the snapshot's Main is back
  const changed = { ...main, name: 'Changed after snapshot' }
  expect((await admin.put(`/api/store/${MAIN}`, { data: JSON.stringify(changed) })).ok()).toBeTruthy()
  expect((await readMain()).name).toBe('Changed after snapshot')
  res = await admin.post(`/api/snapshots/${snap.id}/restore`)
  expect(res.ok()).toBeTruthy()
  expect((await readMain()).name).toBe(main.name)

  expect((await admin.delete(`/api/snapshots/${snap.id}`)).ok()).toBeTruthy()
  const after = (await (await admin.get('/api/snapshots')).json()) as { id: string }[]
  expect(after.map((s) => s.id)).not.toContain(snap.id)

  // an id that is not a snapshot id never reaches the filesystem
  expect((await admin.get('/api/snapshots/..%2F..%2Fusers.json')).status()).toBe(400)
  expect((await admin.get('/api/snapshots/2099-01-01T00-00-00-000Z')).status()).toBe(404)
})

test('snapshots are admin-only', async ({ baseURL }) => {
  const anon = await pwRequest.newContext({ baseURL })
  expect((await anon.get('/api/snapshots')).status()).toBe(401)
  expect((await anon.post('/api/snapshots')).status()).toBe(401)
})
