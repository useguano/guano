import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// server modules under test — plain ESM, safe to import into the spec runner
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// The :slider element: the DOM the exporter emits, the Tailwind utilities that
// DOM needs (the renderer emits them, so nothing else would pull them into the
// stylesheet), the runtime's shipping gate, and the carousel behaviour itself
// driven in a real browser.
//
// The contracts worth pinning: a slider page must actually get /assets/slider.js
// (it has no interactions, so the interaction runtime's gate would miss it), a
// site without one must not pay for it, and autoplay must stop dead under
// reduced motion. (smoke.spec.ts republishes the site dir afterwards, so
// clobbering it here is fine.)

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const BP = [
  { id: 'bp-d', name: 'Desktop', width: 1440, height: 900 },
  { id: 'bp-t', name: 'Tablet', width: 768, height: 1024 },
  { id: 'bp-m', name: 'Mobile', width: 390, height: 844 },
]

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

const SLIDE_COUNT = 5

/** a manual slider (each child is a slide) plus, optionally, a bound one */
function fixture(slider: unknown, opts: { bound?: boolean; slider2?: unknown } = {}) {
  const slides = Array.from({ length: SLIDE_COUNT }, (_, i) =>
    node(`s${i}`, 'div', { htmlId: `slide-${i}`, classes: 'h-40', content: `Slide ${i}` }),
  )
  const body = [
    node('sl', 'slider', { htmlId: 'sl', slider, children: slides }),
    ...(opts.bound
      ? [
          node('sl2', 'slider', {
            htmlId: 'sl2',
            arg: 'post',
            slider: opts.slider2,
            children: [node('t', 'h3', { arg: 'title' })],
          }),
        ]
      : []),
  ]

  return {
    pages: [
      {
        id: 'p1',
        name: 'Home',
        path: '/',
        status: 'published',
        elements: [node('p1-body', 'body', { children: body })],
      },
    ],
    components: [],
    collections: opts.bound
      ? [
          {
            id: 'c1',
            name: 'post',
            detailRoutes: false,
            fields: [{ id: 'f1', name: 'title', type: 'text' }],
            entries: [
              { id: 'e1', name: 'One', slug: 'one', values: { title: 'One' } },
              { id: 'e2', name: 'Two', slug: 'two', values: { title: 'Two' } },
              { id: 'e3', name: 'Three', slug: 'three', values: { title: 'Three' } },
            ],
          },
        ]
      : [],
    interactions: [],
    animations: [],
    breakpoints: BP,
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: {
      publishing: { method: 'server', github: { repo: '', branch: '' } },
      seo: { siteName: 'T', titleTemplate: '%s', description: '' },
      domain: '',
      smtp: {},
      integrations: { stripe: {}, mailing: {} },
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

/** the same site with the slider swapped for a plain div */
function fixtureWithoutSlider() {
  const project = fixture(undefined)
  project.pages[0]!.elements[0]!.children = [node('plain', 'div', { htmlId: 'plain' })]
  return project
}

const home = () => readFile(join(SITE, 'index.html'), 'utf8')

const wireOf = (html: string, htmlId: string) => {
  const found = new RegExp(`id="${htmlId}"[^>]*data-slider="([^"]*)"`).exec(html)
  return found ? JSON.parse(found[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&')) : null
}

test.describe(':slider export', () => {
  test('emits the track/slide DOM and ships the runtime for a page with no interactions', async () => {
    await exportSite(fixture({ perView: { base: 3, 'bp-m': 1 }, gap: 16 }), SITE)
    const html = await home()

    expect(html).toContain('data-sl-track')
    expect((html.match(/data-sl-slide/g) ?? []).length).toBe(SLIDE_COUNT)
    // the per-breakpoint slides-per-view rides one custom property, so a single
    // basis:calc() on every slide covers every breakpoint
    expect(html).toContain('[--sl-pv:3]')
    // the override's media query covers the breakpoint's OWN width: Tailwind
    // reads `max-[390px]` as `width < 390`, which left a viewport at exactly
    // 390 on the base value while the canvas frame for that breakpoint showed
    // the override. The sub-pixel margin makes the compare inclusive, like
    // every other breakpoint compare in the project.
    expect(html).toContain('max-[390.02px]:[--sl-pv:1]')
    expect(html).toContain('[--sl-gap:16px]')
    // chrome is built in, and the dot rail is left for the runtime to fill
    expect(html).toContain('data-sl-prev')
    expect(html).toContain('data-sl-next')
    expect(html).toMatch(/data-sl-dots[^>]*><\/div>/)
    // the page has zero interactions — the interaction runtime's gate would
    // have missed this, which is the whole reason the slider has its own
    expect(html).toContain('/assets/slider.js')
    expect(html).not.toContain('/assets/script.js')
    await expect(readFile(join(SITE, 'assets', 'slider.js'), 'utf8')).resolves.toContain(
      'data-sl-track',
    )
  })

  test('the utilities the renderer invents reach the compiled stylesheet', async () => {
    await exportSite(fixture({ perView: { base: 3, 'bp-m': 1 }, gap: 16 }), SITE)
    const css = await readFile(join(SITE, 'assets', 'style.css'), 'utf8')

    // nobody authored these classes, so only collectCandidates can put them in
    expect(css).toContain('--sl-pv')
    expect(css).toContain('--sl-gap')
    expect(css).toContain('scroll-snap-align')
    expect(css).toContain('scroll-snap-type')
  })

  test('a bound slider repeats one slide per entry, a manual one per child', async () => {
    await exportSite(fixture(undefined, { bound: true }), SITE)
    const html = await home()

    const bound = /id="sl2"[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? ''
    expect((bound.match(/data-sl-slide/g) ?? []).length).toBe(3)
    expect(bound).toContain('One')
    expect(bound).toContain('Three')
  })

  test('chrome switches off, and the wire carries only what differs from defaults', async () => {
    await exportSite(fixture({ arrows: false, dots: false }), SITE)
    const html = await home()

    expect(html).not.toContain('data-sl-prev')
    expect(html).not.toContain('data-sl-dots')
    expect(wireOf(html, 'sl')).toEqual({ ar: 0, dt: 0 })
  })

  test('a default slider rides an empty wire payload', async () => {
    await exportSite(fixture(undefined), SITE)
    expect(wireOf(await home(), 'sl')).toEqual({})
  })

  test('a perView key naming the widest breakpoint behaves exactly like "base"', async () => {
    // the panel only ever writes 'base', but the MCP can name a breakpoint id.
    // A `max-[1440px]:` variant would stop applying ABOVE 1440, so the widest
    // breakpoint has to fold into the base or the canvas and the site disagree.
    await exportSite(fixture({ perView: { 'bp-d': 3 } }), SITE)
    const byId = await home()
    await exportSite(fixture({ perView: { base: 3 } }), SITE)
    const byBase = await home()

    expect(byId).toContain('[--sl-pv:3]')
    expect(byId).not.toContain('max-[1440px]:')
    expect(wireOf(byId, 'sl')).toEqual(wireOf(byBase, 'sl'))
  })

  test('a linked slider is not wrapped in an anchor', async () => {
    // buttons inside <a> is invalid HTML, and every arrow click would navigate
    const project = fixture(undefined)
    ;(project.pages[0]!.elements[0]!.children[0] as Record<string, unknown>).link = '/about'
    await exportSite(project, SITE)
    const html = await home()
    expect(html).not.toMatch(/<a[^>]*>\s*<div[^>]*data-slider/)
  })

  test('a site with no slider ships no slider runtime', async () => {
    await exportSite(fixtureWithoutSlider(), SITE)
    const html = await home()
    expect(html).not.toContain('/assets/slider.js')
    await expect(readFile(join(SITE, 'assets', 'slider.js'), 'utf8')).rejects.toThrow()
  })

  test.describe('in the browser', () => {
    const at = (page: import('@playwright/test').Page) =>
      page.evaluate(() => {
        const track = document.querySelector('#sl [data-sl-track]') as HTMLElement
        const slide = track.querySelector('[data-sl-slide]') as HTMLElement
        const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0
        return Math.round(track.scrollLeft / (slide.getBoundingClientRect().width + gap))
      })

    test('arrows advance, dots follow, and the ends hold without loop', async ({ page }) => {
      await exportSite(fixture({ perView: { base: 1 }, gap: 0 }), SITE)
      await page.goto('/')

      // one dot per reachable position — the runtime measures, so this is 5
      await expect(page.locator('#sl [data-sl-dots] button')).toHaveCount(SLIDE_COUNT)
      await expect(page.locator('#sl [data-sl-prev]')).toHaveAttribute('aria-disabled', 'true')

      await page.click('#sl [data-sl-next]')
      await expect.poll(() => at(page)).toBe(1)
      await expect(page.locator('#sl [data-sl-dots] button').nth(1)).toHaveAttribute(
        'aria-selected',
        'true',
      )

      // clicking a dot jumps straight there
      await page.click('#sl [data-sl-dots] button >> nth=3')
      await expect.poll(() => at(page)).toBe(3)

      // the last position holds: with no loop the arrow goes aria-disabled,
      // which also makes it pointer-events-none — it can't be clicked past
      await page.click('#sl [data-sl-next]')
      await expect.poll(() => at(page)).toBe(SLIDE_COUNT - 1)
      await expect(page.locator('#sl [data-sl-next]')).toHaveAttribute('aria-disabled', 'true')
      await expect(page.locator('#sl [data-sl-next]')).toBeDisabled()
    })

    test('loop wraps around both ends', async ({ page }) => {
      await exportSite(fixture({ perView: { base: 1 }, loop: true }), SITE)
      await page.goto('/')

      await page.click('#sl [data-sl-prev]')
      await expect.poll(() => at(page)).toBe(SLIDE_COUNT - 1)
      await page.click('#sl [data-sl-next]')
      await expect.poll(() => at(page)).toBe(0)
    })

    test('slides-per-view follows the breakpoint, and so does the dot count', async ({ page }) => {
      await exportSite(fixture({ perView: { base: 3, 'bp-m': 1 }, gap: 0 }), SITE)

      await page.setViewportSize({ width: 1200, height: 800 })
      await page.goto('/')
      // 3 visible of 5 → 3 reachable positions
      await expect(page.locator('#sl [data-sl-dots] button')).toHaveCount(3)

      await page.setViewportSize({ width: 360, height: 800 })
      await expect(page.locator('#sl [data-sl-dots] button')).toHaveCount(SLIDE_COUNT)

      // AT the breakpoint's own width the override applies — the canvas frame
      // for Mobile is exactly 390 wide and resolves the number in JS, so the
      // site has to agree with it
      await page.setViewportSize({ width: 390, height: 800 })
      await expect(page.locator('#sl [data-sl-dots] button')).toHaveCount(SLIDE_COUNT)
      expect(
        await page
          .locator('#sl [data-sl-track]')
          .evaluate((t) => getComputedStyle(t).getPropertyValue('--sl-pv').trim()),
      ).toBe('1')

      // and one pixel wider it does not
      await page.setViewportSize({ width: 391, height: 800 })
      expect(
        await page
          .locator('#sl [data-sl-track]')
          .evaluate((t) => getComputedStyle(t).getPropertyValue('--sl-pv').trim()),
      ).toBe('3')
    })

    test('dragging moves the track and swallows only the drag’s own click', async ({ page }) => {
      await exportSite(fixture({ perView: { base: 1 }, gap: 0 }), SITE)
      await page.goto('/')

      const box = (await page.locator('#sl [data-sl-track]').boundingBox())!
      const y = box.y + box.height / 2
      await page.mouse.move(box.x + box.width * 0.8, y)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.1, y, { steps: 10 })
      await page.mouse.up()
      await expect.poll(() => at(page)).toBe(1)

      // a later click is a real click again — the drag's suppression must not
      // outlive the gesture that caused it
      await page.click('#sl [data-sl-next]')
      await expect.poll(() => at(page)).toBe(2)
    })

    test('the active dot is visibly distinct, not decided by stylesheet order', async ({ page }) => {
      // opacity-30 and opacity-100 are the same property at the same
      // specificity, so the two dot states must REPLACE each other rather than
      // stack — which one won would otherwise come down to stylesheet order
      await exportSite(fixture({ perView: { base: 1 } }), SITE)
      await page.goto('/')
      await expect(page.locator('#sl [data-sl-dots] button')).toHaveCount(SLIDE_COUNT)
      const opacities = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#sl [data-sl-dots] button')].map(
            (d) => getComputedStyle(d).opacity,
          ),
        )
      await expect.poll(async () => {
        const [active, ...rest] = await opacities()
        return active !== rest[0] && rest.every((c) => c === rest[0])
      }).toBe(true)
    })

    test('the dots take the host’s text colour, not a hard-coded white', async ({ page }) => {
      // they were bg-white, invisible on any light UI and unreachable from the
      // project's palette; `bg-current` lets `text-*` on the :slider style them
      await exportSite(fixture({ perView: { base: 1 } }), SITE)
      await page.goto('/')
      const [dot, host] = await Promise.all([
        page
          .locator('#sl [data-sl-dots] button')
          .first()
          .evaluate((d) => getComputedStyle(d).backgroundColor),
        page.locator('#sl').evaluate((h) => getComputedStyle(h).color),
      ])
      expect(dot).toBe(host)
    })

    test('the dots sit below the track, never over the slides', async ({ page }) => {
      await exportSite(fixture({ perView: { base: 1 } }), SITE)
      await page.goto('/')
      const [track, dots] = await Promise.all([
        page.locator('#sl [data-sl-track]').boundingBox(),
        page.locator('#sl [data-sl-dots]').boundingBox(),
      ])
      expect(dots!.y).toBeGreaterThanOrEqual(track!.y + track!.height)
    })

    test('autoplay advances on its own', async ({ page }) => {
      await exportSite(fixture({ perView: { base: 1 }, autoplay: true, delay: 600 }), SITE)
      await page.goto('/')
      await expect.poll(() => at(page), { timeout: 4000 }).toBeGreaterThan(0)
    })

    test('autoplay stays put under reduced motion and ?noanim', async ({ page }) => {
      await exportSite(fixture({ perView: { base: 1 }, autoplay: true, delay: 300 }), SITE)

      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/')
      await page.waitForTimeout(1200)
      expect(await at(page)).toBe(0)
      // still a usable carousel — it just never moves by itself, and the move
      // it does make is a jump: a smooth track plus ScrollToOptions' 'auto'
      // would quietly animate it, which is what reduced motion rules out
      await page.click('#sl [data-sl-next]')
      expect(await at(page)).toBe(1)

      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto('/?noanim')
      await page.waitForTimeout(1200)
      expect(await at(page)).toBe(0)
    })
  })
})

// The chrome's WORDS. Renderer-invented like its classes, so they were English
// literals in all three renderers and in the runtime's dot builder: a French
// route shipped "Previous slide" on every carousel and the dots said "Go to
// slide 3" whatever the arrows said. They resolve off the node's ordinary
// localizable attributes now (SLIDER_LABEL_ATTRS), and the DOT pattern travels
// on the wire because only the runtime knows the reachable count.
test.describe(':slider chrome labels', () => {
  const labelled = () => {
    const f = fixture(undefined) as unknown as {
      pages: { elements: { children: { htmlId?: string; attributes?: unknown }[] }[] }[]
    }
    const host = f.pages[0]!.elements[0]!.children.find((n) => n.htmlId === 'sl')!
    host.attributes = {
      'data-prev-label': 'Précédent',
      'data-next-label': 'Suivant',
      'data-dots-label': 'Diapositives',
      'data-dot-label': 'Aller à {n}',
    }
    return f
  }

  test('the defaults ship when nothing is authored, and cost the wire nothing', async () => {
    await exportSite(fixture(undefined), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    expect(html).toContain('aria-label="Previous slide"')
    expect(html).toContain('aria-label="Next slide"')
    expect(html).toContain('aria-label="Slides"')
    // no label on the wire, so an untranslated slider is byte-identical
    expect(/data-slider="[^"]*dl/.test(html)).toBe(false)
    // and the authoring attributes are consumed, never emitted on the host
    expect(html).not.toContain('data-prev-label')
  })

  test('authored labels reach the arrows, the rail AND every dot', async ({ page }) => {
    await exportSite(labelled(), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    expect(html).toContain('aria-label="Précédent"')
    expect(html).toContain('aria-label="Suivant"')
    expect(html).toContain('aria-label="Diapositives"')
    expect(html).not.toContain('data-dot-label=')

    // the dots are built in the browser, from the pattern on the wire
    await page.goto('/')
    const dots = page.locator('[data-sl-dots] button')
    await expect.poll(() => dots.count()).toBeGreaterThan(1)
    expect(await dots.nth(0).getAttribute('aria-label')).toBe('Aller à 1')
    expect(await dots.nth(1).getAttribute('aria-label')).toBe('Aller à 2')
  })

  test('the default dot label still numbers every dot', async ({ page }) => {
    await exportSite(fixture(undefined), SITE)
    await page.goto('/')
    const dots = page.locator('[data-sl-dots] button')
    await expect.poll(() => dots.count()).toBeGreaterThan(1)
    expect(await dots.nth(2).getAttribute('aria-label')).toBe('Go to slide 3')
  })
})
