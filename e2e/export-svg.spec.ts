import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
// server module under test — plain ESM, safe to import into the spec runner
// @ts-expect-error untyped server module
import { extractMedia } from '../server/export-media.mjs'

// FINDINGS S1: data-URL SVGs authored into node.src bypass media intake, so
// the exporter must sanitize them itself, and the static server must send a
// no-script CSP on every .svg it serves.

const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
  '<script>fetch("/api/store")</script><rect width="1" height="1"/></svg>'

test('data-URL SVGs are script-stripped on export', async () => {
  const project = {
    pages: [
      {
        id: 'p1',
        elements: [
          {
            id: 'n1',
            type: 'image',
            src: 'data:image/svg+xml,' + encodeURIComponent(HOSTILE_SVG),
            children: [],
          },
        ],
      },
    ],
    components: [],
    collections: [],
    settings: {},
  }
  const { files, rewrite } = await extractMedia(project)
  const rel = rewrite(project.pages[0].elements[0].src)
  expect(rel).toMatch(/^\/assets\/media\/[a-f0-9]{12}\.svg$/)
  const svgOut = files.get(rel.slice(1)).toString('utf8')
  expect(svgOut).not.toContain('<script')
  expect(svgOut).not.toContain('onload')
  expect(svgOut).toContain('<rect') // the drawing itself survives
})

test('statically served .svg carries a no-script CSP', async ({ request }) => {
  // handleStatic serves whatever sits in the site dir; plant a file in the
  // isolated e2e data dir and assert the response headers on the real server
  const siteMedia = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site', 'assets', 'media')
  mkdirSync(siteMedia, { recursive: true })
  writeFileSync(join(siteMedia, 'csp-check.svg'), HOSTILE_SVG)
  const res = await request.get('/assets/media/csp-check.svg')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('image/svg+xml')
  expect(res.headers()['content-security-policy']).toContain("default-src 'none'")
  expect(res.headers()['x-content-type-options']).toBe('nosniff')
})
