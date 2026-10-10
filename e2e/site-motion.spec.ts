import { test, expect } from '@playwright/test'
import { manifest, motionTriggers, wiredById } from './fixtures/fxWire'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// server modules under test — plain ESM, safe to import into the spec runner
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// Site-wide motion (settings.motion): the appear-mode default, page
// transitions, and smooth scrolling. Exported with the real exporter into the
// e2e data dir and then driven in a real browser, so the emitted wire format
// AND the runtime that consumes it are both under test.
//
// The contract worth pinning here is mostly about what must NOT happen: an
// inherited "once" must cost nothing on the wire, a page must never be left
// hidden if the runtime doesn't arrive, and an intercepted link must always
// end up navigating. (smoke.spec.ts republishes the site dir afterwards, so
// clobbering it here is fine.)

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const FADE_IN = 'a-fade'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

/** `motion` is the settings.motion under test; pages are Home ⇄ About */
function fixture(motion: unknown) {
  const page = (id: string, name: string, path: string, linkTo: string) => ({
    id,
    name,
    path,
    status: 'published',
    elements: [
      node(`${id}-body`, 'body', {
        children: [
          node(`${id}-link`, 'link', { content: `to ${linkTo}`, htmlId: 'nav', link: linkTo }),
          node(`${id}-out`, 'link', {
            content: 'external',
            htmlId: 'ext',
            link: 'https://example.com/',
          }),
          // tall enough that the page actually scrolls
          node(`${id}-tall`, 'div', { htmlId: 'tall', classes: 'h-[300vh]' }),
          // inherits the site default
          node(`${id}-inherit`, 'div', {
            htmlId: 'inherit',
            animations: [{ id: `${id}-b1`, animationId: FADE_IN, trigger: 'appear', targetId: null }],
          }),
          // pins itself to once, whatever the site says
          node(`${id}-once`, 'div', {
            htmlId: 'once',
            animations: [
              {
                id: `${id}-b2`,
                animationId: FADE_IN,
                trigger: 'appear',
                targetId: null,
                appearMode: 'once',
              },
            ],
          }),
        ],
      }),
    ],
  })

  return {
    pages: [page('p1', 'Home', '/', '/about'), page('p2', 'About', '/about', '/')],
    components: [],
    collections: [],
    interactions: [],
    animations: [
      {
        id: FADE_IN,
        name: 'Fade in',
        steps: [
          {
            id: 's1',
            tracks: [{ prop: 'opacity', from: 0, to: 1 }],
            duration: 300,
            easing: 'ease-out',
          },
        ],
      },
    ],
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
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
      motion,
    },
  }
}

/** the same site with every animation binding stripped — nothing on the page
 * animates, so only settings.motion can pull the runtime in */
function fixtureWithoutAnimations(motion: unknown) {
  const project = fixture(motion)
  for (const page of project.pages) {
    for (const body of page.elements) {
      for (const child of body.children as Record<string, unknown>[]) delete child.animations
    }
  }
  project.animations = []
  return project
}

const animMetas = (html: string) => motionTriggers(html, SITE)

/** the manifest slice that used to be its own island */
const jsonTag = (html: string, id: 'anim-lib' | 'site-fx' | 'anim-bp' | 'int-bp') => {
  const man = manifest(html, SITE)
  const slice = { 'anim-lib': man.lib, 'site-fx': man.site, 'anim-bp': man.animbp, 'int-bp': man.bp }[id]
  return slice ?? null
}

test.describe('site-wide motion', () => {
  test('the site appear default resolves at export, costing the wire nothing', async () => {
    await exportSite(fixture({ appearMode: 'replay' }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const metas = animMetas(html)

    // inherited 'replay' travels; an explicit 'once' says nothing, because an
    // absent mode is already what the runtime plays once
    expect(metas).toHaveLength(2)
    expect(wiredById(html, 'inherit', SITE)!.m![0]!.o!.m).toBe('replay')
    expect(wiredById(html, 'once', SITE)!.m![0]!.o).toBeUndefined()
  })

  test('an inherited "once" emits no options at all', async () => {
    await exportSite(fixture({ appearMode: 'once' }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    for (const meta of animMetas(html)) expect(meta.o).toBeUndefined()
  })

  test('transitions ship their timelines in the existing library tag', async () => {
    await exportSite(fixture({ transitions: { enabled: true, preset: 'fade' } }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')

    const fx = jsonTag(html, 'site-fx')
    const lib = jsonTag(html, 'anim-lib')
    // both halves are named, and each names a timeline that actually ships —
    // the keys are interned, so this is the relationship rather than the id
    expect(fx.t.x).toBeTruthy()
    expect(fx.t.e).toBeTruthy()
    expect(fx.t.x).not.toBe(fx.t.e)
    expect(Object.keys(lib)).toEqual(expect.arrayContaining([fx.t.x, fx.t.e]))

    // the no-flash guard, and its self-release for a runtime that never arrives
    expect(html).toContain('html.gt-enter body{opacity:0}')
    expect(html).toContain("classList.add('gt-enter')")
    expect(html).toContain("classList.remove('gt-enter')")
  })

  test('smooth scroll alone still ships the runtime', async () => {
    await exportSite(fixtureWithoutAnimations({ scroll: { enabled: true, lerp: 0.12 } }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')

    expect(jsonTag(html, 'site-fx')).toEqual({ s: { l: 0.12 } })
    // nothing on the page animates, so the runtime ships for the setting alone
    expect(html).toContain('/assets/motion.js')
    expect(jsonTag(html, 'anim-lib')).toBeNull()
    // and there is no entrance to hide the page for
    expect(html).not.toContain('gt-enter')
  })

  test('nothing is emitted when the site sets no motion', async () => {
    await exportSite(fixtureWithoutAnimations(undefined), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    expect(jsonTag(html, 'site-fx')).toBeNull()
    expect(html).not.toContain('gt-enter')
    expect(html).not.toContain('/assets/motion.js')
  })

  test.describe('in the browser', () => {
    test.beforeAll(async () => {
      await exportSite(fixture({ transitions: { enabled: true, preset: 'fade', duration: 200 } }), SITE)
    })

    test('the page reveals itself and an intercepted link still navigates', async ({ page }) => {
      await page.goto('/')
      // the enter transition runs to completion — the guard class is released
      // and the body is fully opaque, not stuck on its first frame
      await expect(page.locator('html')).not.toHaveClass(/gt-enter/)
      await expect
        .poll(() => page.evaluate(() => Number(getComputedStyle(document.body).opacity)))
        .toBeGreaterThan(0.99)

      await page.click('#nav')
      await page.waitForURL('**/about**', { timeout: 3000 })
      await expect
        .poll(() => page.evaluate(() => Number(getComputedStyle(document.body).opacity)))
        .toBeGreaterThan(0.99)
    })

    test('a finished slide leaves no transform behind on body', async ({ page }) => {
      // slide-up, not fade: this is the case that WRITES a transform. One left
      // on <body> makes it the containing block for every position:fixed
      // descendant — permanently, long after the transition — so a fixed header
      // would quietly stop being fixed. See clearWhenDone() in the runtime.
      await exportSite(
        fixture({ transitions: { enabled: true, preset: 'slide-up', duration: 200 } }),
        SITE,
      )
      await page.goto('/')
      // it really is a sliding transition: the transform lands first…
      await expect
        .poll(() => page.evaluate(() => document.body.style.transform || ''))
        .toContain('translateY')
      // …and is gone once the entrance finishes
      await expect
        .poll(() => page.evaluate(() => document.body.style.transform || ''), { timeout: 5000 })
        .toBe('')
    })

    test('?noanim navigates natively and never hides the page', async ({ page }) => {
      await page.goto('/?noanim')
      await expect(page.locator('html')).not.toHaveClass(/gt-enter/)
      expect(
        await page.evaluate(() => Number(getComputedStyle(document.body).opacity)),
      ).toBeCloseTo(1)
      await page.click('#nav')
      await page.waitForURL('**/about**', { timeout: 3000 })
    })
  })
})

// ---------------------------------------------------------------------------
// The `count` track: the ONE property that writes TEXT rather than style.
//
// THE LOAD-BEARING RULE: a count's `from` is NEVER baked into the exported
// HTML. The exporter writes initialStyle into the markup so an entrance does
// not flash its final state — which for a number would ship `0` as the text a
// visitor without JavaScript, and every visitor with reduced motion, reads
// forever. The authored text IS the final value; the runtime writes the first
// frame, and `still` mode never touches the text at all.

const COUNT = 'a-count'

function countFixture() {
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
              node('stat', 'span', {
                htmlId: 'stat',
                content: '18,000+',
                animations: [{ id: 'cb1', animationId: COUNT, trigger: 'load' }],
              }),
            ],
          }),
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [],
    animations: [
      {
        id: COUNT,
        name: 'Count up',
        steps: [
          {
            id: 'cs1',
            tracks: [{ prop: 'count', from: 0, to: 18000, format: { group: true, suffix: '+' } }],
            duration: 900,
            easing: 'linear',
          },
        ],
      },
    ],
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
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

test.describe('a count track', () => {
  test.beforeAll(async () => {
    await exportSite(countFixture(), SITE)
  })

  test('the authored number ships, and no first frame is baked over it', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const tag = /<span[^>]*id="stat"[^>]*>([^<]*)</.exec(html)!
    // the FINAL value is what the markup says — not `0`, and not a formatted 0
    expect(tag[1]).toBe('18,000+')
    // and nothing was baked: a count contributes no initial style at all
    expect(/<span[^>]*id="stat"[^>]*style=/.test(html)).toBe(false)
  })

  test('the runtime counts up to the authored text and stops there', async ({ page }) => {
    const seen: string[] = []
    await page.exposeFunction('record', (t: string) => void seen.push(t))
    await page.addInitScript(() => {
      // installed before the runtime, so every write it makes is observed
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('stat')
        if (!el) return
        new MutationObserver(() => {
          ;(window as unknown as { record: (t: string) => void }).record(el.textContent ?? '')
        }).observe(el, { childList: true, characterData: true, subtree: true })
      })
    })
    await page.goto('/')
    // it ends on the authored text…
    await expect.poll(() => page.locator('#stat').textContent(), { timeout: 5000 }).toBe('18,000+')
    // …having passed through something else on the way, grouped and suffixed
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.some((t) => t !== '18,000+' && /^[\d,]+\+$/.test(t))).toBe(true)
  })

  test('?noanim reads the authored number, written by nobody', async ({ page }) => {
    const writes: string[] = []
    await page.exposeFunction('record', (t: string) => void writes.push(t))
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('stat')
        if (!el) return
        new MutationObserver(() => {
          ;(window as unknown as { record: (t: string) => void }).record(el.textContent ?? '')
        }).observe(el, { childList: true, characterData: true, subtree: true })
      })
    })
    await page.goto('/?noanim')
    expect(await page.locator('#stat').textContent()).toBe('18,000+')
    // `still` mode never touches the text: the end state IS what is in the
    // markup, so writing it would be churn — and a `0` first frame would be
    // what this visitor reads forever
    await page.waitForTimeout(500)
    expect(writes).toEqual([])
  })
})

// ONE timeline, FOUR destinations. `to` lives on the shared Animation in
// project.animations, so a count bound on a component MASTER reaches every
// instance through one compiled track — and every instance used to end on the
// master's number while the exported HTML held the right ones (initialStyle
// bakes no count, so the markup was correct and the first frame overwrote it:
// 12 / 99 / 11 / 140 all read 12). The element's own text is the only
// per-instance value there is, so that is what a count counts up to; the
// track's `to` is the fallback for text holding no number.
//
// The single-span fixture above cannot catch this — it passes either way,
// because its authored text happens to equal sampleText(to).

const SHARED_COUNT = 'a-shared-count'
const FIGURES = ['12', '99', '11', '140']

function sharedMasterCountFixture() {
  // one master: a span carrying the count binding, no text of its own
  const master = {
    id: 'm-stat-root',
    type: 'StatCounter',
    children: [
      node('m-stat-num', 'span', {
        animations: [{ id: 'cb-shared', animationId: SHARED_COUNT, trigger: 'load' }],
      }),
    ],
  }
  // four instances, each overriding the figure on its own positional part
  const instances = FIGURES.map((figure, i) => ({
    id: `inst-${i}`,
    type: 'StatCounter',
    children: [node(`inst-${i}-num`, 'span', { htmlId: `fig${i}`, content: figure })],
  }))
  return {
    pages: [
      {
        id: 'p1',
        name: 'Home',
        path: '/',
        status: 'published',
        elements: [node('body', 'body', { children: instances })],
      },
    ],
    components: [{ id: 'c-stat', name: 'StatCounter', root: master }],
    collections: [],
    interactions: [],
    animations: [
      {
        id: SHARED_COUNT,
        name: 'Count up',
        steps: [
          { id: 'cs1', tracks: [{ prop: 'count', from: 0, to: 12 }], duration: 700, easing: 'linear' },
        ],
      },
    ],
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
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

test.describe('a count on a shared component master', () => {
  test.beforeAll(async () => {
    await exportSite(sharedMasterCountFixture(), SITE)
  })

  test('every instance ships its own figure, and none is baked over', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    for (const [i, figure] of FIGURES.entries()) {
      const tag = new RegExp(`<span[^>]*id="fig${i}"[^>]*>([^<]*)<`).exec(html)
      expect(tag?.[1], `fig${i} in the markup`).toBe(figure)
    }
    expect(/<span[^>]*id="fig\d"[^>]*style=/.test(html)).toBe(false)
  })

  test('each counts up to ITS OWN number, from one timeline', async ({ page }) => {
    await page.goto('/')
    // every one lands on its own figure — not all four on the master's 12
    for (const [i, figure] of FIGURES.entries()) {
      await expect
        .poll(() => page.locator(`#fig${i}`).textContent(), { timeout: 5000 })
        .toBe(figure)
    }
  })

  test('the figures move while the timeline runs', async ({ page }) => {
    const seen: Record<string, Set<string>> = {}
    await page.exposeFunction('record', (id: string, t: string) => {
      ;(seen[id] ??= new Set()).add(t)
    })
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        for (const el of document.querySelectorAll('[id^="fig"]')) {
          new MutationObserver(() => {
            ;(window as unknown as { record: (i: string, t: string) => void }).record(
              el.id,
              el.textContent ?? '',
            )
          }).observe(el, { childList: true, characterData: true, subtree: true })
        }
      })
    })
    await page.goto('/')
    await expect.poll(() => page.locator('#fig3').textContent(), { timeout: 5000 }).toBe('140')
    await page.waitForTimeout(100)
    // the 140 card must have been through three-digit values the 12 card never
    // sees — proof the destinations really are per element and not one shared
    // number dressed up
    expect([...(seen.fig3 ?? [])].some((t) => Number(t) > 12)).toBe(true)
    expect([...(seen.fig0 ?? [])].every((t) => Number(t) <= 12)).toBe(true)
  })

  test('reduced motion and ?noanim leave all four figures alone', async ({ browser }) => {
    for (const [label, ctxOpts, url] of [
      ['reduced motion', { reducedMotion: 'reduce' as const }, '/'],
      ['noanim', {}, '/?noanim'],
    ] as const) {
      const ctx = await browser.newContext(ctxOpts)
      const page = await ctx.newPage()
      const writes: string[] = []
      await page.exposeFunction('record', (t: string) => void writes.push(t))
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          for (const el of document.querySelectorAll('[id^="fig"]')) {
            new MutationObserver(() => {
              ;(window as unknown as { record: (t: string) => void }).record(el.textContent ?? '')
            }).observe(el, { childList: true, characterData: true, subtree: true })
          }
        })
      })
      await page.goto(url)
      await page.waitForTimeout(600)
      for (const [i, figure] of FIGURES.entries()) {
        expect(await page.locator(`#fig${i}`).textContent(), `${label} fig${i}`).toBe(figure)
      }
      // `still` mode never writes a count: the end state is already in the markup
      expect(writes, label).toEqual([])
      await ctx.close()
    }
  })
})

// Several `load` timelines on ONE element, and a binding-level `delay`. The
// exporter used to merge each binding's first frame in binding order with the
// last one winning, so an element with an "open" (opacity 0 → 1) and a later
// "close" (1 → 0) was primed on the close's `from` and sat fully VISIBLE at
// t=0 — both of its states painted at once. The rule is now the earliest
// start wins per property (binding delay + track offset), shared by the
// exporter and the runtime (primeFirstFrame).

const OPEN = 'a-open'
const CLOSE = 'a-close'
const DROP = 'a-drop'
const NOFROM = 'a-nofrom'
const WIGGLE = 'a-wiggle'

function primingFixture() {
  const fade = (id: string, name: string, from: number, to: number) => ({
    id,
    name,
    steps: [{ id: `${id}-s`, tracks: [{ prop: 'opacity', from, to }], duration: 400, easing: 'linear' }],
  })
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
              // open listed FIRST, close (delayed) second — the order that
              // used to prime it visible
              node('both', 'div', {
                htmlId: 'both',
                content: 'panel',
                animations: [
                  { id: 'b-open', animationId: OPEN, trigger: 'load' },
                  { id: 'b-close', animationId: CLOSE, trigger: 'load', delay: 3000 },
                ],
              }),
              // the same two, listed the other way round: position must not matter
              node('both-rev', 'div', {
                htmlId: 'both-rev',
                content: 'panel',
                animations: [
                  { id: 'r-close', animationId: CLOSE, trigger: 'load', delay: 3000 },
                  { id: 'r-open', animationId: OPEN, trigger: 'load' },
                ],
              }),
              // a HOVER with an explicit `from`: the `from` is the resting
              // value, so this ships at opacity 0 and comes up on hover.
              // Primed only for load/appear, it shipped visible and snapped
              // to 0 on the first hover frame before fading back in.
              node('hov', 'div', {
                htmlId: 'hov',
                content: 'hover me',
                classes: 'h-20 w-20',
                animations: [{ id: 'b-hov', animationId: OPEN, trigger: 'hover' }],
              }),
              // a hover with NO `from` tweens from wherever the element is, so
              // it primes nothing — the ordinary shape of a hover effect
              node('hov-rel', 'div', {
                htmlId: 'hov-rel',
                content: 'hover me too',
                classes: 'h-20 w-20',
                animations: [{ id: 'b-hov-rel', animationId: NOFROM, trigger: 'hover' }],
              }),
              // a `from` that IS the property's default states nothing the
              // element does not already render, so it primes nothing and
              // cannot shadow the class transform — a baked rotate(0deg)
              // would have killed `rotate-6` at rest. The resting value is
              // still decided by that first track, not by the next one along,
              // so the wiggle's -10 never reaches the markup either.
              node('wig', 'div', {
                htmlId: 'wig',
                content: 'wiggle',
                classes: 'h-20 w-20 rotate-6',
                animations: [{ id: 'b-wig', animationId: WIGGLE, trigger: 'hover' }],
              }),
              // one delayed entrance: holds frame 0 for the wait, then plays
              node('late', 'div', {
                htmlId: 'late',
                content: 'late',
                animations: [{ id: 'b-late', animationId: DROP, trigger: 'load', delay: 1500 }],
              }),
            ],
          }),
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [],
    animations: [
      fade(OPEN, 'Open', 0, 1),
      fade(CLOSE, 'Close', 1, 0),
      {
        id: DROP,
        name: 'Drop in',
        steps: [{ id: 'd-s', tracks: [{ prop: 'y', from: 40, to: 0 }], duration: 300, easing: 'linear' }],
      },
      {
        id: NOFROM,
        name: 'Dim',
        steps: [
          { id: 'n-s', tracks: [{ prop: 'opacity', to: 0.5 }], duration: 200, easing: 'linear' },
        ],
      },
      {
        id: WIGGLE,
        name: 'Wiggle',
        steps: [
          { id: 'w1', tracks: [{ prop: 'rotate', from: 0, to: -10 }], duration: 120, easing: 'linear' },
          { id: 'w2', tracks: [{ prop: 'rotate', from: -10, to: 0 }], duration: 120, easing: 'linear' },
        ],
      },
    ],
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
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

test.describe('several entrances on one element, and a delayed binding', () => {
  test.beforeAll(async () => {
    await exportSite(primingFixture(), SITE)
  })

  test('the earliest-starting timeline decides the baked first frame, whatever the order', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    for (const id of ['both', 'both-rev']) {
      const tag = new RegExp(`<div[^>]*id="${id}"[^>]*>`).exec(html)![0]
      // the open (opacity 0 → 1, at once) starts before the close (delay 3000),
      // so the element is primed INVISIBLE — not on the close's `from: 1`
      expect(tag).toMatch(/style="[^"]*opacity:\s*0[;"]/)
      expect(tag).not.toMatch(/opacity:\s*1/)
    }
  })

  test('the delay rides on the wire as `d`, and only when set', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    // #both declares open then close (delayed); #late is the delayed entrance
    const both = wiredById(html, 'both', SITE)!.m!
    expect(both).toHaveLength(2)
    expect(both[1]!.d).toBe(3000)
    expect(wiredById(html, 'late', SITE)!.m![0]!.d).toBe(1500)
    // an undelayed binding carries no key at all
    expect('d' in both[0]!).toBe(false)
  })

  test('the runtime holds the first frame through the wait, then plays', async ({ page }) => {
    await page.goto('/')
    const late = page.locator('#late')
    // primed by the export, and the runtime keeps writing frame 0 while it waits
    expect(await late.evaluate((el) => (el as HTMLElement).style.transform)).toContain('40px')
    await page.waitForTimeout(600)
    expect(await late.evaluate((el) => (el as HTMLElement).style.transform)).toContain('40px')
    // 1500 ms of wait + 300 ms of travel: well before 4 s it has landed
    await expect
      .poll(() => late.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 4000 })
      .not.toContain('40px')
    await expect
      .poll(() => late.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 2000 })
      .toMatch(/translateY\(0(px)?\)/)
  })

  test("a hover's explicit `from` is the resting state, and an omitted one primes nothing", async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const tag = (id: string) => new RegExp(`<div[^>]*id="${id}"[^>]*>`).exec(html)![0]
    expect(tag('hov')).toMatch(/style="[^"]*opacity:\s*0[;"]/)
    expect(tag('hov-rel')).not.toMatch(/opacity:/)
    // the default-valued `from` writes nothing AND still owns the property
    expect(tag('wig')).not.toMatch(/style="/)
  })

  test('a hover tween comes up from its `from` and goes back to it on leave', async ({ page }) => {
    await page.goto('/')
    const hov = page.locator('#hov')
    const opacity = () => hov.evaluate((el) => (el as HTMLElement).style.opacity)
    // the runtime agrees with the baked frame: at rest it is the `from`
    await expect.poll(opacity, { timeout: 2000 }).toBe('0')
    await hov.hover()
    await expect.poll(opacity, { timeout: 2000 }).toBe('1')
    // hover rewinds on leave, back to the resting value — never to 1
    await page.mouse.move(0, 0)
    await expect.poll(opacity, { timeout: 2000 }).toBe('0')
  })

  test('the open plays, and the delayed close takes the element back out', async ({ page }) => {
    await page.goto('/')
    const both = page.locator('#both')
    // the open runs first: opacity climbs to 1 inside the first second
    await expect.poll(() => both.evaluate((el) => (el as HTMLElement).style.opacity), { timeout: 2000 }).toBe('1')
    // and the close, 3 s in, takes it back to 0
    await expect.poll(() => both.evaluate((el) => (el as HTMLElement).style.opacity), { timeout: 5000 }).toBe('0')
  })
})
