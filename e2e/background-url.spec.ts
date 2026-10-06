import { test, expect } from '@playwright/test'
// shared module — used verbatim by both the Vue renderers and the exporter
// @ts-expect-error untyped shared module
import { backgroundRender } from '../src/lib/shared/background.js'

// FINDINGS S3: a crafted background URL must not be able to close the CSS
// url() and inject extra declarations into the host's inline style.

test('background url() cannot be broken out of', () => {
  const hostile = 'https://a);position:fixed;inset:0;background:url(https://evil/log'
  const bg = backgroundRender('image', hostile, [])
  expect(bg).not.toBeNull()
  // parens are percent-encoded, the URL is quoted — one declaration set only
  expect(bg!.style).toContain('url("https://a%29;position:fixed')
  expect(bg!.style).not.toMatch(/url\((?!")/)
  const quoteBreak = backgroundRender('image', 'https://a"onload="x', ['bg-cover'])
  expect(quoteBreak!.style).toBe('background-image:url("https://a%22onload=%22x")')
})

test('normal background URLs pass through byte-identical', () => {
  const bg = backgroundRender('image', '/assets/media/abc123def456.jpg', ['bg-contain'])
  expect(bg!.style).toBe('background-image:url("/assets/media/abc123def456.jpg")')
  const noSize = backgroundRender('image', 'https://example.com/x-y_z.png', [])
  expect(noSize!.style).toBe(
    'background-image:url("https://example.com/x-y_z.png");background-size:cover;background-position:center',
  )
})
