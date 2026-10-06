import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// Attribute TEXT a visitor reads — a placeholder, an icon button's aria-label,
// an image's alt — is translatable, and a component's placement can override it.
//
// Neither was possible. The Cocoapp prototype shipped English placeholders and
// aria-labels on every French route, and could not reuse the library's Input for
// a search field because `placeholder` is shared by every instance: it copied
// Input's class string onto plain `:input:` elements instead and lost the
// component.

test.describe('attribute text per placement and per locale', () => {
  async function page() {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<input data-ref="search" />\n<input data-ref="name" />'),
      version: home.version,
    })
    return s
  }

  test('a locale overrides a placeholder, and the base shows elsewhere', async () => {
    const s = await page()
    let after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'search', attributes: { type: 'search', placeholder: 'Search contacts' } }],
    })
    after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      locale: 'fr',
      edits: [{ ref: 'search', attributes: { placeholder: 'Rechercher des contacts' } }],
    })
    expect(r.failed).toBe(0)

    const routes = await s.exportAll()
    expect(routes['index.html']).toContain('placeholder="Search contacts"')
    expect(routes['fr/index.html']).toContain('placeholder="Rechercher des contacts"')
    // `type` is structural and the same in every language
    expect(routes['fr/index.html']).toContain('type="search"')
  })

  test('only text attributes are localizable', async () => {
    const s = await page()
    const after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      locale: 'fr',
      edits: [{ ref: 'search', attributes: { type: 'tel' } }],
    })
    expect(r.failed).toBe(1)
    expect(JSON.stringify(r)).toContain('localizable')
  })

  test('the worklist lists attribute text, so "nothing left" means it', async () => {
    const s = await page()
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'search', attributes: { placeholder: 'Search contacts' } },
        { ref: 'name', attributes: { 'aria-label': 'Full name', type: 'text' } },
      ],
    })

    // a bare call returns the COUNTERS only (cost discipline) — a filter is how
    // you ask for items
    const wl = await s.call('get_translation_worklist', { locale: 'fr', kind: 'attribute' })
    const attrs = wl.items as { kind: string; attribute: string; key: string }[]
    expect(attrs.map((a: { attribute: string }) => a.attribute).sort()).toEqual([
      'aria-label',
      'placeholder',
    ])
    expect(attrs[0].base).toEqual({ untrusted: true, text: 'Search contacts' })
    // `type` is not offered — it is structural
    expect(JSON.stringify(attrs)).not.toContain('"type":"text"')

    // and translating one through set_translations lands — by HANDLE, which is
    // what a keyed item is for
    const one = attrs.find((a) => a.attribute === 'placeholder')!
    const w = await s.call('set_translations', {
      locale: 'fr',
      handle: wl.handle,
      items: [
        {
          key: one.key,
          text: 'Rechercher',
        },
      ],
    })
    expect(w.written).toBe(1)
    expect((await s.exportAll())['fr/index.html']).toContain('placeholder="Rechercher"')
  })

  test('one placement overrides a component’s attribute without touching the others', async () => {
    const s = await mcpSession()
    await s.seed(['input'])
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Input data-ref="a" />\n<Input data-ref="b" />'),
      version: home.version,
    })
    const after = await s.home()
    // the master's placeholder is shared; THIS placement says something else
    const inside = (await s.call('get_page', { pageId: after.id, elements: 'all' })).elements.filter(
      (e: { type: string }) => e.type === 'input',
    )
    expect(inside).toHaveLength(2)
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { id: inside[0].id, instanceAttributes: { placeholder: 'Search contacts' } },
        { id: inside[1].id, instanceAttributes: { placeholder: 'Your email' } },
      ],
    })
    expect(r.failed).toBe(0)

    const html = await s.html()
    expect(html).toContain('placeholder="Search contacts"')
    expect(html).toContain('placeholder="Your email"')
    // and the shared `type` still comes from the master
    expect((html.match(/type="text"/g) ?? []).length).toBe(2)
  })

  // The language switcher. `@locale:<code>` is THIS route in another locale —
  // a plain `/…` link cannot express it, because internal links are prefixed
  // with the CURRENT locale and from /fr every path leads back to /fr/….
  //
  // Every reader tested `startsWith('locale:')` while the stored sentinel
  // carries the `@`, exactly as `@item` does — so the href resolved to null
  // and the switcher shipped as an `<a>` with no destination at all, on every
  // route, in both languages.
  test('an @locale: link exports the same route in the other language', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('create_page', { name: 'About', slug: '/about' })
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<a data-ref="to-fr" href="@locale:fr"><span>FR</span></a>',
          '<a data-ref="to-en" href="@locale:en"><span>EN</span></a>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const about = (await s.call('list_pages', {})).pages.find(
      (p: { slug: string }) => p.slug === '/about',
    )
    await s.call('set_page_html', {
      pageId: about.id,
      html: pageHtml('<a data-ref="to-fr" href="@locale:fr"><span>FR</span></a>'),
      version: about.version,
    })

    const routes = await s.exportAll()
    // from the English home, FR goes to /fr — and EN to the route itself
    expect(routes['index.html']).toContain('href="/fr"')
    expect(routes['index.html']).toContain('href="/"')
    // from the French home it is still /fr: the switcher names a language,
    // it does not toggle
    expect(routes['fr/index.html']).toContain('href="/fr"')
    // and it re-prefixes THIS route, not the home page
    expect(routes['about/index.html']).toContain('href="/fr/about"')
    expect(routes['fr/about/index.html']).toContain('href="/fr/about"')
    // never an anchor with no destination, which is what shipped before
    expect(routes['index.html']).not.toMatch(/<a class=[^>]*><span>FR<\/span>/)
  })
})

// The carousel's chrome — "Previous slide", "Next slide", "Slides", and each
// dot's "Go to slide N" — is renderer-invented, like its Tailwind classes. So it
// lived in no tree: nothing translated it, every /fr/ route shipped English, and
// the worklist reached `missingTranslatable: 0` with it sitting there. The four
// SLIDER_LABEL_ATTRS are ordinary localizable attributes, so the mechanism that
// already exists for placeholder/alt/title carries them.
test.describe('the slider chrome speaks the route’s language', () => {
  async function sliderPage() {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<slider data-ref="deck">\n  <div><span>One</span></div>\n  <div><span>Two</span></div>\n</slider>'),
    })
    return s
  }

  test('the defaults ship, and a locale override replaces them', async () => {
    const s = await sliderPage()
    const before = await s.html()
    // the built-in English, on the default route
    expect(before).toContain('aria-label="Previous slide"')
    expect(before).toContain('aria-label="Next slide"')
    expect(before).toContain('aria-label="Slides"')
    // and the label attributes are CONSUMED, never emitted on the host
    expect(before).not.toContain('data-prev-label')

    const after = await s.home()
    const edit = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      locale: 'fr',
      edits: [
        {
          ref: 'deck',
          attributes: {
            'data-prev-label': 'Diapositive précédente',
            'data-next-label': 'Diapositive suivante',
            'data-dots-label': 'Diapositives',
            'data-dot-label': 'Aller à la diapositive {n}',
          },
        },
      ],
    })
    expect(edit.failed).toBe(0)

    const routes = await s.exportAll()
    const fr = routes['fr/index.html']
    expect(fr).toContain('aria-label="Diapositive précédente"')
    expect(fr).toContain('aria-label="Diapositive suivante"')
    expect(fr).toContain('aria-label="Diapositives"')
    // the DOTS are built in the browser, so the pattern travels on the wire
    expect(fr).toMatch(/data-slider="[^"]*Aller/)

    // the default route is untouched…
    const en = routes['index.html']
    expect(en).toContain('aria-label="Previous slide"')
    // …and its wire carries no label at all, so an untranslated slider is
    // byte-identical to before this existed
    expect(en).not.toMatch(/data-slider="[^"]*dl/)
  })

  test('the worklist offers them, and the counters stop lying', async () => {
    const s = await sliderPage()
    const work = await s.call('get_translation_worklist', { locale: 'fr', kind: 'attribute' })
    const items = work.items as { attribute: string; key: string; base: unknown }[]
    expect(items.map((i) => i.attribute).sort()).toEqual([
      'data-dot-label',
      'data-dots-label',
      'data-next-label',
      'data-prev-label',
    ])
    // the base is the built-in English, so there is something to translate FROM
    const prev = items.find((i) => i.attribute === 'data-prev-label')!
    expect(JSON.stringify(prev.base)).toContain('Previous slide')
    const counts = await s.call('get_translation_worklist', { locale: 'fr', countsOnly: true })
    expect(counts.missingTranslatable).toBeGreaterThanOrEqual(4)

    // set_translations writes them through the existing attribute path
    const wrote = await s.call('set_translations', {
      locale: 'fr',
      handle: work.handle,
      items: [{ key: prev.key, text: 'Précédent' }],
    })
    expect(wrote.failures ?? []).toEqual([])
    expect((await s.exportAll())['fr/index.html']).toContain('aria-label="Précédent"')
  })

  test('publish names them as untranslated while they are', async () => {
    const s = await sliderPage()
    const warnings = (await s.call('publish')).warnings ?? []
    const hit = warnings.find((w: { kind: string }) => w.kind === 'untranslated-attributes')
    expect(hit, JSON.stringify(warnings.map((w: { kind: string }) => w.kind))).toBeTruthy()
    expect(JSON.stringify(hit.where)).toContain('label')
  })
})
