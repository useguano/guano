import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml, type McpSession } from './fixtures/mcpSession'

// `publish` returns design warnings, never refusals. They are the only review an
// agent gets, so a FALSE one costs real work: the Cocoapp session rebound a
// perfectly good staggered entrance from `load` to `appear` to clear
// `load-animation-moves-layout`, which did not apply to it in the first place.
// The cases below are the checks that review asked for, and the ones it got wrong.

/** a grid of 14 cards — over the 12-descendant threshold the check uses */
const GRID = [
  '<section data-ref="grid">',
  ...Array.from({ length: 14 }, () => '  <span />'),
  '</section>',
].join('\n')

/** bind `animationId` to #grid with the given trigger */
async function bindToGrid(s: McpSession, animationId: string, trigger: string) {
  const home = await s.home()
  await s.call('set_page_html', { pageId: home.id, html: pageHtml(GRID), version: home.version })
  const after = await s.home()
  await s.call('edit_elements', {
    pageId: after.id,
    version: after.version,
    edits: [{ ref: 'grid', bindAnimations: [{ animationId, trigger }] }],
  })
}

const moveStep = (stagger?: number) => ({
  duration: 420,
  easing: 'quart-out',
  ...(stagger === undefined ? {} : { stagger }),
  tracks: [
    { prop: 'opacity', from: 0, to: 1 },
    { prop: 'y', from: 14, to: 0 },
  ],
})

test.describe('publish design warnings', () => {
  test('a load animation that moves a big container is flagged', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Slide in', steps: [moveStep()] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).toContain('load-animation-moves-layout')
  })

  test('a STAGGERED load animation is not flagged — it moves the children, not the container', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Cards stagger in', steps: [moveStep(70)] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    // splitByStagger (shared/motion.js) sends a staggered track to the
    // container's children; the container itself is never transformed, which is
    // exactly the "small items, staggered" shape the warning recommends
    expect(await s.kinds()).not.toContain('load-animation-moves-layout')
  })

  test('a timeline that staggers one step and moves the container in another is still flagged', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Mixed', steps: [moveStep(70), moveStep()] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).toContain('load-animation-moves-layout')
  })

  test('an INFINITE loop is never flagged — a marquee is supposed to move', async () => {
    const s = await mcpSession()
    // Vezaro, MINOR: a 40s linear `x: 0% → -50%` marquee on `load`, bound to
    // the track inside an overflow-hidden strip, was reported as "the whole
    // region shifts on every page load". The track IS the moving part, the
    // guide lists marquees as a thing to build, and the only way to silence it
    // was to switch the trigger to `appear` for no reason.
    const { created } = await s.call('create_animations', {
      items: [
        {
          name: 'Marquee',
          steps: [
            {
              duration: 40_000,
              easing: 'linear',
              repeat: -1,
              tracks: [{ prop: 'x', from: '0%', to: '-50%' }],
            },
          ],
        },
      ],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).not.toContain('load-animation-moves-layout')
  })

  test('an opacity-only load animation is never flagged', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [
        { name: 'Fade', steps: [{ duration: 300, easing: 'ease-out', tracks: [{ prop: 'opacity', from: 0, to: 1 }] }] },
      ],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).not.toContain('load-animation-moves-layout')
  })
})

test.describe('what a review sends back', () => {
  test('removing an element takes the bindings that pointed at it', async () => {
    // `binding-target-unreachable` still guards the case a write CANNOT fix —
    // a trigger and a target in two different repeats (below). But a target
    // simply deleted from the page no longer leaves a dangling binding behind:
    // the write drops it, exactly as the editor's own delete does. That is
    // worth asserting, because the warning used to be the only thing standing
    // between a deletion and an effect that silently did nothing.
    const s = await mcpSession()
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        '<button data-ref="open">\n  <span />\n</button>\n<div data-ref="panel">\n  <span />\n</div>',
      ),
      version: home.version,
    })
    let after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'open', bindInteractions: [{ interactionId: created[0].id, targetRef: 'panel', trigger: 'click' }] },
      ],
    })
    expect(await s.kinds()).not.toContain('binding-target-unreachable')

    after = await s.home()
    await s.call('set_page_html', {
      pageId: after.id,
      html: pageHtml('<button data-ref="open">\n  <span />\n</button>'),
      version: after.version,
    })
    const page = await s.call('get_page', { pageId: after.id, includeInteractions: true })
    const open = page.elements.find((e: { ref?: string }) => e.ref === 'open')
    expect(open.interactions).toBeUndefined()
    expect(await s.kinds()).not.toContain('binding-target-unreachable')
  })

  test('a button inside a linked container is flagged', async () => {
    const s = await mcpSession()
    const home = await s.home()
    // :div@/reports exports as <a>…</a>, and a :button inside it is invalid
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-ref="card" href="/reports">\n  <button>\n    <span />\n  </button>\n</div>'),
      version: home.version,
    })
    const kinds = await s.kinds()
    expect(kinds).toContain('interactive-inside-link')
  })

  test('a heavy row template over many entries is flagged, a small one is not', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'contact', detailRoutes: false })).collection
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: Array.from({ length: 12 }, (_, i) => ({ name: `Person ${i}` })),
    })
    const home = await s.home()
    const smallRow = '<collection-list source="contact">\n  <div>\n    <span />\n  </div>\n</collection-list>'
    await s.call('set_page_html', { pageId: home.id, html: pageHtml(smallRow), version: home.version })
    expect(await s.kinds()).not.toContain('heavy-repeat')

    // a 40-node drawer in every row is what made one route 300 KB
    const heavyRow = [
      '<collection-list source="contact">',
      '  <div>',
      ...Array.from({ length: 45 }, () => '    <span />'),
      '  </div>',
      '</collection-list>',
    ].join('\n')
    const after = await s.home()
    await s.call('set_page_html', { pageId: after.id, html: pageHtml(heavyRow), version: after.version })
    expect(await s.kinds()).toContain('heavy-repeat')
  })

  test('attribute text with no translation is flagged, and a translation clears it', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<input data-ref="search" />'),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'search', attributes: { placeholder: 'Search contacts' } }],
    })
    // one locale: nothing to say
    expect(await s.kinds()).not.toContain('untranslated-attributes')

    await s.call('update_settings', { addLocales: ['fr'] })
    expect(await s.kinds()).toContain('untranslated-attributes')

    // it names work left, not a limit: translating it clears the warning
    const now = await s.home()
    await s.call('edit_elements', {
      pageId: now.id,
      version: now.version,
      locale: 'fr',
      edits: [{ ref: 'search', attributes: { placeholder: 'Rechercher des contacts' } }],
    })
    expect(await s.kinds()).not.toContain('untranslated-attributes')
  })

  // The worklist flags a bare number or a glyph as `looksStructural` ("do NOT
  // translate") while this check flagged the same string as work left — in a
  // message promising that `missingTranslatable: 0` now means it. The only way
  // out was to write "8" as the French for "8".
  test('a structural attribute value is not counted as untranslated', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<input data-ref="size" />\n<input data-ref="search" />'),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'size', attributes: { placeholder: '8' } },
        { ref: 'search', attributes: { 'aria-label': 'Search' } },
      ],
    })
    // the prose one is real work and is named…
    const warning = (await s.call('publish', {})).warnings.find(
      (w: { kind: string }) => w.kind === 'untranslated-attributes',
    )
    expect(JSON.stringify(warning.where)).toContain('aria-label')
    // …and the bare number the worklist told the agent to skip is not
    expect(JSON.stringify(warning.where)).not.toContain('placeholder')
  })

  // The form check read each control's `attributes` alone, while the EXPORT
  // (and the Data panel) read the merged layers. So a form built the way the
  // guide says to build one — one Input component, named per placement with
  // `instanceAttributes` — was reported as "has no NAMED field" in the same
  // response whose `stats.forms` listed the names.
  test('a form whose controls are named per placement is not flagged', async () => {
    const s = await mcpSession()
    await s.call('create_component', {
      name: 'Field',
      html: '<input class="rounded border px-3 py-2" type="text" />',
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<form data-ref="contact">',
          '  <Field />',
          '  <Field />',
          '  <button><span>Send</span></button>',
          '  <form-success><span>Thanks</span></form-success>',
          '</form>',
        ].join('\n'),
      ),
      version: home.version,
    })
    let after = await s.home()
    const inputs = (
      await s.call('get_page', { pageId: after.id, elements: 'all' })
    ).elements.filter((e: { type: string }) => e.type === 'input')
    expect(inputs).toHaveLength(2)
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { id: inputs[0].id, instanceAttributes: { name: 'email' } },
        { id: inputs[1].id, instanceAttributes: { name: 'message' } },
      ],
    })
    after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'contact', form: { enabled: true } }],
    })

    expect(await s.kinds()).not.toContain('form-setup')
    // and the names the warning could not see are the ones that really ship:
    // the export reads the same merged layers the check now reads
    const html = await s.html()
    expect(html).toContain('name="email"')
    expect(html).toContain('name="message"')
  })

  test('a form that really collects nothing is still flagged', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<form data-ref="contact">',
          '  <input />',
          '  <button><span>Send</span></button>',
          '  <form-success><span>Thanks</span></form-success>',
          '</form>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'contact', form: { enabled: true } }],
    })
    expect(await s.kinds()).toContain('form-setup')
  })

  test('a trigger and a target in two different repeats is flagged', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'row', detailRoutes: false })).collection
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'One' }, { name: 'Two' }],
    })
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    const home = await s.home()
    // two sibling lists: a trigger in one cannot know WHICH row of the other to
    // drive, so the key can never match and the click does nothing
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<collection-list source="row">',
          '  <button data-ref="rowOpen">',
          '    <span />',
          '  </button>',
          '</collection-list>',
          '<collection-list source="row">',
          '  <div data-ref="rowPanel">',
          '    <span />',
          '  </div>',
          '</collection-list>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        {
          ref: 'rowOpen',
          bindInteractions: [
            { interactionId: created[0].id, targetRef: 'rowPanel', trigger: 'click' },
          ],
        },
      ],
    })
    expect(await s.kinds()).toContain('binding-target-unreachable')
  })

  test('a heavy export is flagged by its per-route weight', async () => {
    // a backstop above heavy-repeat, which catches the usual cause. 150 KB of
    // HTML for one route is already a lot of inlined structure; the Cocoapp
    // prototype averaged 67 KB and is NOT what this is for.
    const heavy = await mcpSession('T', { routes: 26, bytes: 26 * 200_000 })
    expect(await heavy.kinds()).toContain('route-size')

    const cocoapp = await mcpSession('T', { routes: 26, bytes: 1_734_037 })
    expect(await cocoapp.kinds()).not.toContain('route-size')
  })
})

// E14: a slug change leaves every link to the old route pointing at a 404, and
// a 404 on a static host is the last thing anyone discovers. `update_page`
// names them (and moves them on request); `publish` warns about any that are
// left, from any cause — a changed slug, a page turned draft.
test.describe('dead internal links', () => {
  test('update_page names the links to the old slug, and can move them', async () => {
    const s = await mcpSession()
    const made = await s.call('create_page', { name: 'Pricing', slug: '/pricing' })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        '<a data-ref="nav-pricing" href="/pricing"><span>Pricing</span></a>' +
          '<a data-ref="nav-home" href="/"><span>Home</span></a>',
      ),
      version: home.version,
    })
    await s.call('create_component', {
      name: 'Footer',
      html: '<footer class="p-4"><a href="/pricing"><span>Plans</span></a></footer>',
    })

    const page = (await s.call('list_pages')).pages.find((p: { id: string }) => p.id === made.pageId)
    const moved = await s.call('update_page', {
      pageId: made.pageId,
      slug: '/plans',
      version: page.version,
    })
    expect(moved.saved).toBe(true)
    // both of them, named, with the page or component they are on
    const hits = moved.linksToOldSlug as { link: string; ref?: string; component?: string }[]
    expect(hits).toHaveLength(2)
    expect(hits.every((h) => h.link === '/pricing')).toBe(true)
    expect(hits.some((h) => h.ref === 'nav-pricing')).toBe(true)
    expect(hits.some((h) => h.component === 'Footer')).toBe(true)
    // and publish says so, because they really are 404s now
    expect(await s.kinds()).toContain('dead-internal-link')

    // rewriteLinks moves them with the page
    const again = (await s.call('list_pages')).pages.find(
      (p: { id: string }) => p.id === made.pageId,
    )
    const back = await s.call('update_page', {
      pageId: made.pageId,
      slug: '/pricing',
      version: again.version,
      rewriteLinks: true,
    })
    // nothing pointed at /plans, so there is nothing to rewrite and no key
    expect(back.saved).toBe(true)
    expect(back.rewroteLinks).toBeUndefined()
    expect(back.linksToOldSlug).toBeUndefined()
    const third = (await s.call('list_pages')).pages.find(
      (p: { id: string }) => p.id === made.pageId,
    )
    const fwd = await s.call('update_page', {
      pageId: made.pageId,
      slug: '/plans',
      version: third.version,
      rewriteLinks: true,
    })
    expect(fwd.rewroteLinks).toBe(2)
    expect(fwd.linksToOldSlug).toBeUndefined()
    const html = await s.html()
    expect(html).toContain('href="/plans"')
    expect(html).not.toContain('href="/pricing"')
    expect(await s.kinds()).not.toContain('dead-internal-link')
  })

  test('a link to a draft page is a dead link too', async () => {
    const s = await mcpSession()
    const made = await s.call('create_page', { name: 'Soon', slug: '/soon' })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<a data-ref="l" href="/soon"><span>Soon</span></a>'),
      version: home.version,
    })
    expect(await s.kinds()).not.toContain('dead-internal-link')

    const page = (await s.call('list_pages')).pages.find((p: { id: string }) => p.id === made.pageId)
    await s.call('update_page', { pageId: made.pageId, status: 'draft', version: page.version })
    expect(await s.kinds()).toContain('dead-internal-link')
  })

  test('an entry route and an external URL are not flagged', async () => {
    const s = await mcpSession()
    const col = (await s.call('create_collection', { name: 'post' })).collection
    await s.call('upsert_entries', { collectionId: col.id, entries: [{ name: 'One' }] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        '<a data-ref="a" href="/post/one"><span>One</span></a>' +
          '<a data-ref="b" href="https://example.com/"><span>Out</span></a>' +
          '<a data-ref="c" href="/#faq"><span>FAQ</span></a>',
      ),
      version: home.version,
    })
    expect(await s.kinds()).not.toContain('dead-internal-link')
  })
})

test.describe('a count on a shared master', () => {
  // A count counts up to the number the ELEMENT says, which is what lets one
  // timeline on a component master drive a different figure per instance.
  // countTargetError checks a node's OWN text at bind time; only publish knows
  // what every INSTANCE says, and that is the half that bites — a master whose
  // own text reads back perfectly can be overridden on every page by one that
  // does not, and that instance silently lands on the track's `to`.
  test("a count whose instance text it cannot read back is flagged", async () => {
    const s = await mcpSession()
    const made = await s.call('create_animations', {
      items: [
        {
          name: 'Count up',
          steps: [{ duration: 700, easing: 'linear', tracks: [{ prop: 'count', from: 0, to: 12 }] }],
        },
      ],
    })
    const animationId = made.created[0].id as string

    // a master with no text of its own, carrying the binding
    const comp = await s.call('create_component', {
      name: 'StatCounter',
      html: '<div>\n  <span />\n</div>',
    })
    const num = comp.nodes.find((n: { type: string }) => n.type === 'span')
    expect(
      (
        await s.call('edit_elements', {
          componentId: comp.componentId,
          edits: [{ id: num.id, bindAnimations: [{ animationId, trigger: 'load' }] }],
        })
      ).failed,
    ).toBe(0)

    // two instances whose figures read back cleanly: nothing to say
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml(
        '<StatCounter data-ref="a"><div><span>12</span></div></StatCounter>' +
          '<StatCounter data-ref="b"><div><span>140</span></div></StatCounter>',
      ),
    })
    expect(await s.kinds()).not.toContain('count-text-unreadable')

    // one instance says something the track cannot read: flagged, by instance
    const again = await s.home()
    await s.call('set_page_html', {
      pageId: again.id,
      version: again.version,
      html: pageHtml(
        '<StatCounter data-ref="a"><div><span>12</span></div></StatCounter>' +
          '<StatCounter data-ref="b"><div><span>a few</span></div></StatCounter>',
      ),
    })
    const warnings = (await s.call('publish')).warnings ?? []
    const hit = warnings.find((w: { kind: string }) => w.kind === 'count-text-unreadable')
    expect(hit, JSON.stringify(warnings.map((w: { kind: string }) => w.kind))).toBeTruthy()
    expect(JSON.stringify(hit.where)).toContain('a few')
  })
})
