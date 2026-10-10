import { test, expect, type Page } from '@playwright/test'
import { motionTriggers, wiredById } from './fixtures/fxWire'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// The `mouse` trigger: continuous progress like `scrub`, driven by the pointer
// instead of the scroll. Exported with the real exporter and then driven in a
// real browser, so the wire format AND the runtime that consumes it are both
// under test.
//
// A follow is authored the way Webflow's is — the binding sits on the BOX the
// pointer is measured across (here a 400px stage) and aims at the element that
// moves, so one trigger can drive several children off one pointer.
//
// The contract that costs the most if it breaks is the RESTING frame. Every
// other trigger rests at its track's `from`, and a follow authored -n → n
// would then ship shoved hard to one end of its travel — visible to every
// visitor before the deferred runtime boots, and forever to one with
// JavaScript off or reduced motion on. A follow rests at the MIDDLE, which for
// the symmetric case is the property's own default and so must emit no inline
// style at all (an inline transform would shadow the classes beside it).

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const FOLLOW_X = 'a-follow-x'
const FOLLOW_Y = 'a-follow-y'
const DRIFT_Y = 'a-drift-y'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

const bind = (
  id: string,
  animationId: string,
  targetId: string,
  mouse: Record<string, unknown>,
) => ({ id, animationId, targetId, trigger: 'mouse', mouse })

const timeline = (id: string, name: string, prop: string, from: string, to: string) => ({
  id,
  name,
  steps: [{ id: `${id}-s`, tracks: [{ prop, from, to }], duration: 400, easing: 'linear' }],
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
          node('p1-body', 'body', {
            children: [
              // the stage is a fixed 400px box at the origin, so a pointer
              // coordinate maps to a known progress without measuring anything
              node('stage', 'div', {
                htmlId: 'stage',
                classes: 'absolute left-0 top-0 h-[400px] w-[400px]',
                animations: [
                  // two actions under ONE trigger: x and y, which is how a 2D
                  // follow is authored — one timeline carries one progress
                  bind('b-x', FOLLOW_X, 'card', { axis: 'x', area: 'element', smooth: 0 }),
                  bind('b-y', FOLLOW_Y, 'card', { axis: 'y', area: 'element', smooth: 0 }),
                  // asymmetric: its middle is a real value, so it IS baked
                  bind('b-skew', DRIFT_Y, 'skew', { axis: 'y', smooth: 0 }),
                  // the same pointer measured across the viewport instead
                  bind('b-page', FOLLOW_X, 'ghost', { area: 'page', smooth: 0 }),
                ],
                children: [node('card', 'div', { htmlId: 'card', classes: 'size-10 bg-black' })],
              }),
              node('skew', 'div', { htmlId: 'skew', classes: 'size-10' }),
              node('ghost', 'div', { htmlId: 'ghost', classes: 'size-10' }),
              // a hover on the same timeline, for the contrast: it rests at
              // `from`, which is what a follow must NOT do
              node('hovered', 'div', {
                htmlId: 'hovered',
                classes: 'size-10',
                animations: [
                  { id: 'b-hover', animationId: FOLLOW_X, trigger: 'hover', targetId: null },
                ],
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
      timeline(FOLLOW_X, 'Follow x', 'x', '-100px', '100px'),
      timeline(FOLLOW_Y, 'Follow y', 'y', '-40px', '40px'),
      timeline(DRIFT_Y, 'Drift y', 'y', '0px', '40px'),
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

const animMetas = (html: string) => motionTriggers(html, SITE)

const styleOf = (html: string, id: string) => {
  const tag = new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`).exec(html)
  if (!tag) throw new Error(`no element #${id} in the export`)
  return /style="([^"]*)"/.exec(tag[0])?.[1] ?? null
}

/** a px value the runtime has written into the inline transform */
async function moved(page: Page, id: string, fn: 'translateX' | 'translateY') {
  const style = (await page.locator(`#${id}`).getAttribute('style')) ?? ''
  const found = new RegExp(`${fn}\\((-?[\\d.]+)px\\)`).exec(style)
  return found ? Number(found[1]) : NaN
}

test.describe('a mouse follow', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('a symmetric follow bakes NO resting style, while a hover bakes its from', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    // the middle of -100 → 100 is 0, the property's own default — writing it
    // inline would shadow a class and change nothing else
    expect(styleOf(html, 'card')).toBeNull()
    expect(styleOf(html, 'ghost')).toBeNull()
    // the asymmetric one's middle is real, so it ships
    expect(styleOf(html, 'skew')).toContain('translateY(20px)')
    // and the contrast: the same timeline on a hover still rests at `from`
    expect(styleOf(html, 'hovered')).toContain('translateX(-100px)')
  })

  test('the wire carries only what differs from the defaults', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    // every binding sits on #stage, in the order the fixture declares them:
    // x, y, skew, page. Binding keys are interned at export, so the element is
    // what a spec addresses them by.
    const metas = wiredById(html, 'stage', SITE)!.m!
    expect(metas).toHaveLength(4)
    const [x, , skew, viewport] = metas

    expect(x!.t).toBe('mouse')
    expect(x!.o!.mo).toEqual({ axis: 'x', area: 'element', smooth: 0 })
    // a mouse binding shares no play and nothing waits for it
    expect(x!.s).toBeUndefined()
    expect(x!.d).toBeUndefined()

    expect(viewport!.o!.mo).toEqual({ area: 'page', smooth: 0 })
    // the default axis is not spelled out
    expect(skew!.o!.mo).toEqual({ axis: 'y', smooth: 0 })
  })

  test('the runtime follows the pointer across the box, both ways', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#card')).toBeVisible()

    // #stage is 400px at the origin, so clientX 300 is 0.75 across it, which
    // on a -100 → 100 track is +50px
    await page.mouse.move(300, 300)
    await expect.poll(() => moved(page, 'card', 'translateX'), { timeout: 2000 }).toBeCloseTo(50, 0)

    // back the other way: a follow is symmetric, with no state to toggle
    await page.mouse.move(100, 200)
    await expect.poll(() => moved(page, 'card', 'translateX'), { timeout: 2000 }).toBeCloseTo(-50, 0)

    // and the centre is a value it returns TO, not a leftover edge
    await page.mouse.move(200, 200)
    await expect.poll(() => moved(page, 'card', 'translateX'), { timeout: 2000 }).toBeCloseTo(0, 0)
  })

  test('two actions under one trigger compose into one transform', async ({ page }) => {
    await page.goto('/')
    await page.mouse.move(300, 300)
    // x from its own binding, y from the other — one element, one transform
    await expect
      .poll(() => page.locator('#card').getAttribute('style'), { timeout: 2000 })
      .toMatch(/translateX\(50px\)[^"]*translateY\(20px\)/)
  })

  test('one pointer drives several targets, each on its own timeline', async ({ page }) => {
    await page.goto('/')
    await page.mouse.move(300, 300)
    // the same y progress (0.75) through a 0 → 40 track instead of -40 → 40
    await expect.poll(() => moved(page, 'skew', 'translateY'), { timeout: 2000 }).toBeCloseTo(30, 0)
  })

  test('"whole page" measures the viewport, not the element that binds it', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 })
    await page.goto('/')
    // clientX 300 is 0.75 of the 400px stage but 0.3 of a 1000px viewport, so
    // the two land in different places off one pointer move
    await page.mouse.move(300, 300)
    await expect.poll(() => moved(page, 'ghost', 'translateX'), { timeout: 2000 }).toBeCloseTo(-40, 0)
    expect(await moved(page, 'card', 'translateX')).toBeCloseTo(50, 0)
  })

  test('?noanim never moves it, and leaves the baked rest alone', async ({ page }) => {
    await page.goto('/?noanim')
    await page.mouse.move(300, 200)
    await page.mouse.move(120, 260)
    // the whole driver stands down under reduced motion
    expect(await page.locator('#card').getAttribute('style')).toBeNull()
    expect(await page.locator('#skew').getAttribute('style')).toContain('translateY(20px)')
  })
})
