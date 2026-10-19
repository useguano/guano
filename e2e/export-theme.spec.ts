import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// server modules under test — plain ESM, safe to import into the spec runner
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// Theming by colour mode. A token carries an optional `dark` value and the
// palette is emitted twice — the light values in `@theme`, the dark ones under
// the `dark` marker class — so `bg-background` needs no `dark:` counterpart and
// a retheme stays one token edit. `dark:` itself is CLASS-based here, because
// an interaction can only add a class and evict what it conflicts with, which
// is two states and not three (see DARK_VARIANT in shared/prose.js).
//
// The toggle is the thing that used to be impossible: an interaction whose
// `toClasses` is `dark`, evicting the base `light`. That eviction is what
// shared/interactionClasses.js got wrong for every ARBITRARY property —
// `[color-scheme:light]` and `[color-scheme:dark]` were never seen as one
// property, so both shipped, the stylesheet resolved them by source order and
// the published toggle did nothing while every tool reported success.

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const LIGHT = '#ffffff'
const DARK = '#08090b'
const TO_DARK = 'i-dark'
const SCHEME = 'i-scheme'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

function fixture() {
  return {
    pages: [
      {
        id: 'p1',
        name: 'Home',
        path: '/',
        status: 'published',
        elements: [
          node('body', 'body', {
            children: [
              // the site root: light by default, and the one element the
              // toggle writes to. Both markers live in one conflict group, so
              // the fired `dark` takes `light` off.
              node('root', 'div', {
                htmlId: 'root',
                classes: 'light bg-background text-foreground',
                children: [
                  node('toggle', 'button', {
                    htmlId: 'toggle',
                    content: 'theme',
                    interactions: [
                      { id: 'b1', interactionId: TO_DARK, trigger: 'click', targetId: 'root' },
                    ],
                  }),
                  node('card', 'div', {
                    htmlId: 'card',
                    classes: 'bg-surface',
                    content: 'card',
                  }),
                  // a `dark:` utility, for what a token cannot express
                  node('sun', 'div', { htmlId: 'sun', classes: 'dark:hidden', content: 'sun' }),
                  node('moon', 'div', {
                    htmlId: 'moon',
                    classes: 'hidden dark:block',
                    content: 'moon',
                  }),
                  // a light island inside the dark subtree reads light again
                  node('island', 'div', {
                    htmlId: 'island',
                    classes: 'light bg-background',
                    content: 'island',
                  }),
                ],
              }),
              // the arbitrary-property eviction, on its own element
              node('scheme', 'div', {
                htmlId: 'scheme',
                classes: '[color-scheme:light]',
                children: [
                  node('flip', 'button', {
                    htmlId: 'flip',
                    content: 'flip',
                    interactions: [
                      { id: 'b2', interactionId: SCHEME, trigger: 'click', targetId: 'scheme' },
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [
      { id: TO_DARK, name: 'Dark', toClasses: 'dark', duration: 'duration-200', easing: 'ease-out' },
      {
        id: SCHEME,
        name: 'Scheme dark',
        toClasses: '[color-scheme:dark]',
        duration: 'duration-200',
        easing: 'ease-out',
      },
    ],
    animations: [],
    breakpoints: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: {
      publishing: { method: 'server', github: { repo: '', branch: '' } },
      seo: { siteName: 'T', titleTemplate: '%s', description: '' },
      domain: '',
      smtp: {},
      integrations: { stripe: {}, mailing: {} },
      tokens: [
        { id: '1', name: 'background', value: LIGHT, dark: DARK },
        { id: '2', name: 'foreground', value: '#0a0a0b', dark: '#f3f4f6' },
        { id: '3', name: 'surface', value: '#f7f7f8', dark: '#101217' },
        // no dark value: one colour in both modes, the right answer for a brand
        { id: '4', name: 'brand', value: '#0d594a' },
      ],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

/** the native switcher: a `@theme` link, the head script, and a stored choice */
function switcherFixture(colorMode?: 'dark' | 'system') {
  const project = fixture()
  const body = project.pages[0]!.elements[0]! as { children: Record<string, unknown>[] }
  const root = body.children[0]! as { children: Record<string, unknown>[] }
  root.children.push(
    node('switch', 'button', { htmlId: 'switch', content: 'mode', link: '@theme' }),
    node('pin-light', 'link', { htmlId: 'pin-light', content: 'light', link: '@theme:light' }),
    node('pin-sys', 'button', { htmlId: 'pin-sys', content: 'system', link: '@theme:system' }),
  )
  // the native switcher owns <html>, so the shell root carries no marker
  root.classes = 'bg-background text-foreground'
  if (colorMode) {
    const settings = project.settings as { theme?: Record<string, string> }
    settings.theme = { ...(settings.theme ?? {}), colorMode }
  }
  return project
}

const bg = (el: string) =>
  `getComputedStyle(document.querySelector('${el}')).backgroundColor`

test.describe('theming by colour mode', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('the palette ships twice, and a token with no dark value in neither block', async () => {
    const css = await readFile(join(SITE, 'assets', 'style.css'), 'utf8')
    // the light values are the theme's own
    expect(css).toMatch(/@layer theme\{[^}]*--color-background:#fff/)
    // and the dark half is UNLAYERED, which is what lets it beat @theme's
    // `:root` block without a specificity hack
    expect(css).toContain(':where(.dark){--color-background:#08090b')
    expect(css).toContain(':where(.light){--color-background:#fff')
    // `brand` has one value in both modes, so it is in neither override
    expect(/:where\(\.dark\)\{[^}]*brand/.test(css)).toBe(false)
    expect(/:where\(\.light\)\{[^}]*brand/.test(css)).toBe(false)
    // `dark:` compiles to the marker class, never to prefers-color-scheme
    expect(css).toContain('.dark\\:hidden:where(.dark,.dark *)')
    expect(css).not.toMatch(/prefers-color-scheme/)
  })

  test('the toggle flips the palette, and the base marker is evicted', async ({ page }) => {
    await page.goto('/')
    const root = page.locator('#root')
    await expect.poll(() => page.evaluate(bg('#root'))).toBe('rgb(255, 255, 255)')
    expect(await page.evaluate(bg('#card'))).toBe('rgb(247, 247, 248)')
    await expect(page.locator('#moon')).toBeHidden()
    await expect(page.locator('#sun')).toBeVisible()

    await page.locator('#toggle').click()

    // the fired `dark` evicts the base `light` — both are one property, and
    // leaving both on resolved by source order instead of by the toggle
    await expect(root).toHaveClass(/(^|\s)dark(\s|$)/)
    await expect(root).not.toHaveClass(/(^|\s)light(\s|$)/)
    await expect.poll(() => page.evaluate(bg('#root'))).toBe('rgb(8, 9, 11)')
    expect(await page.evaluate(bg('#card'))).toBe('rgb(16, 18, 23)')
    // the `dark:` utilities swap with it, which is what a token cannot do
    await expect(page.locator('#moon')).toBeVisible()
    await expect(page.locator('#sun')).toBeHidden()
    // the light island is light again inside the dark subtree
    expect(await page.evaluate(bg('#island'))).toBe('rgb(255, 255, 255)')

    // and clicking back is light again — the toggle has two states, not three
    await page.locator('#toggle').click()
    await expect.poll(() => page.evaluate(bg('#root'))).toBe('rgb(255, 255, 255)')
  })

  test('an arbitrary property evicts the base with the same property name', async ({ page }) => {
    await page.goto('/')
    const scheme = page.locator('#scheme')
    expect(
      await page.evaluate(`getComputedStyle(document.querySelector('#scheme')).colorScheme`),
    ).toBe('light')
    await page.locator('#flip').click()
    await expect(scheme).not.toHaveClass(/color-scheme:light/)
    await expect
      .poll(() =>
        page.evaluate(`getComputedStyle(document.querySelector('#scheme')).colorScheme`),
      )
      .toBe('dark')
  })
})

test.describe('the native colour-mode switcher', () => {
  test('a light-only site pays nothing, and a switching one gets a blocking head script', async () => {
    await exportSite(fixture(), SITE)
    const plain = await readFile(join(SITE, 'index.html'), 'utf8')
    expect(plain).not.toContain('superbird-theme')

    await exportSite(switcherFixture(), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const head = html.slice(0, html.indexOf('</head>'))
    // in <head>, synchronous, and BEFORE the stylesheet: the mode has to be on
    // <html> before the first paint or a dark visitor sees the light site flash
    expect(head).toContain("localStorage.getItem(K)")
    expect(head.indexOf('superbird-theme')).toBeLessThan(head.indexOf('/assets/style.css'))
    expect(html).not.toContain('defer src="/assets/script.js"')

    // the switcher itself: a reserved attribute, no href on a non-anchor, and
    // a '#' on an <a> so it stays keyboard-operable
    expect(/<button[^>]*id="switch"[^>]*data-superbird-theme="toggle"/.test(html)).toBe(true)
    expect(/<a[^>]*id="pin-light"[^>]*>/.exec(html)![0]).toContain('href="#"')
    expect(/<a[^>]*id="pin-light"[^>]*>/.exec(html)![0]).toContain('data-superbird-theme="light"')
    // a switcher is not a navigation, so nothing is wrapped in a contents anchor
    expect(html).not.toMatch(/<a href="#" class="contents"[^>]*><button[^>]*id="switch"/)
  })

  test('a stored choice is applied before the first paint, and survives a reload', async ({
    page,
  }) => {
    await exportSite(switcherFixture(), SITE)
    await page.goto('/')
    // nothing stored and the site opens light
    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/)
    await expect.poll(() => page.evaluate(bg('#root'))).toBe('rgb(255, 255, 255)')

    await page.locator('#switch').click()
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    // #root also carries the earlier interaction's `transition-all`, so the
    // colour is polled for its settled value, never sampled mid-tween
    await expect.poll(() => page.evaluate(bg('#root'))).toBe('rgb(8, 9, 11)')
    expect(await page.evaluate('localStorage.getItem("superbird-theme")')).toBe('dark')
    // color-scheme follows it, which is what darkens the native scrollbars
    expect(await page.evaluate('document.documentElement.style.colorScheme')).toBe('dark')

    // THE BUG THIS FEATURE EXISTS FOR: on the next load the class is already
    // on <html> when the document is still parsing — no light paint, no flash
    await page.goto('/')
    const atParse = await page.evaluate(
      'document.documentElement.classList.contains("dark")',
    )
    expect(atParse).toBe(true)
    await expect.poll(() => page.evaluate(bg('#root'))).toBe('rgb(8, 9, 11)')

    // and a pinned mode wins over the stored one
    await page.locator('#pin-light').click()
    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/)
    expect(await page.evaluate('localStorage.getItem("superbird-theme")')).toBe('light')
  })

  test('"the visitor\'s system" is followed until they choose, and giving it back works', async ({
    page,
  }) => {
    await exportSite(switcherFixture('system'), SITE)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    expect(await page.evaluate('localStorage.getItem("superbird-theme")')).toBe(null)

    // an explicit choice wins over the system — the state a two-state class
    // toggle could never express, which is why this is a head script
    await page.locator('#switch').click()
    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/)
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/)

    // and handing it back to the system restores the OS answer
    await page.locator('#pin-sys').click()
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    expect(await page.evaluate('localStorage.getItem("superbird-theme")')).toBe(null)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/)
  })
})
