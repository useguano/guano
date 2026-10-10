import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// What a form becomes in the EXPORTED HTML, and what the publish refuses.
//
// Checked against the real export rather than the tree, because the whole bug
// class this guards is "the tool reported success for a write that renders
// nowhere": a form whose action points at nothing, a state block that shows on
// first paint, a secret key printed into a public <script>.

const FORM = [
  '<form data-ref="contact">',
  '  <input name="email" type="email" required />',
  '  <textarea name="message"></textarea>',
  '  <button><span>Send</span></button>',
  '  <form-success data-ref="done"><div data-type="text">Thanks</div></form-success>',
  '  <form-error data-ref="oops"><div data-type="text">Sorry</div></form-error>',
  '</form>',
].join('\n')

async function session(html = FORM) {
  const s = await mcpSession()
  const home = await s.home()
  const r = await s.call('set_page_html', { pageId: home.id, html: pageHtml(html), version: home.version })
  expect(r.saved).toBe(true)
  return s
}

test.describe('a form in the export', () => {
  test('a plain form posts nowhere; an enabled one posts to the public namespace', async () => {
    const s = await session()

    // not enabled: no action, no honeypot, nothing stored anywhere
    let html = await s.html()
    expect(html).not.toMatch(/<form[^>]*action=/)
    expect(html).not.toContain('name="_hp"')
    // the state blocks are always emitted, and always start hidden — the
    // visitor must not see "Thanks" before they have submitted
    expect(html).toContain('data-form-success hidden')
    expect(html).toContain('data-form-error hidden')

    // turn it on through the tool an agent would use
    const after = await s.home()
    const edit = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'contact', form: { enabled: true, name: 'Contact', notify: true } }],
    })
    expect(edit.saved).toBe(true)
    expect(edit.failures).toBeUndefined()
    expect(edit.opsApplied).toBe(1)

    html = await s.html()
    expect(html).toMatch(/<form[^>]*method="post"/)
    expect(html).toMatch(/action="\/_guano\/forms\/[A-Za-z0-9-]+"/)
    // the id in the action is the form node's own, which is what the manifest
    // keys on — a mismatch would make every submission a 404
    const action = /action="\/_guano\/forms\/([A-Za-z0-9-]+)"/.exec(html)![1]
    expect(html).toContain(`data-form="${action}"`)
    // the spam traps a static page can actually carry
    expect(html).toContain('name="_hp"')
    expect(html).toContain('class="gf-hp"')
    expect(html).toContain('name="_route"')
    // and the runtime, which a form needs even with no interactions on the page
    expect(html).toContain('/assets/script.js')
  })

  test('a form that is not enabled cannot be submitted at all', async () => {
    const s = await session()
    const html = await s.html()

    // Vezaro, MAJOR: the handbook said a form left alone "sends nothing", and
    // a bare <form> does not sit still — Enter in a text field, or any
    // <button> with no type, GETs the current url with every named control in
    // the query string. On a health questionnaire that is the answers in the
    // address bar, in history and in the host's access logs.
    //
    // method="dialog" is the no-script fix: the browser abandons the
    // submission of a dialog-method form with no <dialog> ancestor.
    expect(html).toMatch(/<form[^>]*method="dialog"/)
    expect(html).toMatch(/<form[^>]*data-form-inert/)
    // still no endpoint, no honeypot, nothing stored anywhere
    expect(html).not.toMatch(/<form[^>]*action=/)
    expect(html).not.toContain('name="_hp"')

    // and an enabled form is NOT marked inert — the two are exclusive
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'contact', form: { enabled: true, name: 'Contact' } }],
    })
    const live = await s.html()
    expect(live).not.toContain('data-form-inert')
    expect(live).toMatch(/<form[^>]*method="post"/)
  })

  test('the honeypot rule ships only for a site that has a form', async () => {
    const plain = await mcpSession()
    const home = await plain.home()
    await plain.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-type="text">no forms here</div>'),
      version: home.version,
    })
    expect(await plain.css()).not.toContain('.gf-hp')

    const s = await session()
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'contact', form: { enabled: true } }],
    })
    expect(await s.css()).toContain('.gf-hp')
  })

  test('a redirect must be a path on this site', async () => {
    const s = await session()
    const home = await s.home()
    const good = await s.call('edit_elements', {
      pageId: home.id,
      version: home.version,
      edits: [{ ref: 'contact', form: { enabled: true, redirect: '/thanks' } }],
    })
    expect(JSON.stringify(good)).not.toContain('refused')
    expect(await s.html()).toContain('data-form-redirect="/thanks"')

    // an off-site redirect is refused by the tool, not quietly stored
    const after = await s.home()
    const bad = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'contact', form: { enabled: true, redirect: 'https://evil.example/x' } }],
    })
    expect(JSON.stringify(bad)).toContain('refused')
    // and the stored value is untouched
    expect(await s.html()).toContain('data-form-redirect="/thanks"')
  })

  test('`form` is refused on anything that is not a form', async () => {
    const s = await session('<div data-ref="box"><div data-type="text">x</div></div>')
    const home = await s.home()
    const r = await s.call('edit_elements', {
      pageId: home.id,
      version: home.version,
      edits: [{ ref: 'box', form: { enabled: true } }],
    })
    expect(JSON.stringify(r)).toContain('is not a form')
  })

  test('a misplaced or duplicated state block is reported', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml(
        [
          '<form data-ref="f">',
          '  <input name="a" />',
          '  <form-success data-ref="s1"><div data-type="text">a</div></form-success>',
          '  <form-success data-ref="s2"><div data-type="text">b</div></form-success>',
          '</form>',
          '<form-success data-ref="loose"><div data-type="text">c</div></form-success>',
        ].join('\n'),
      ),
    })
    const said = JSON.stringify(r)
    expect(said).toContain('only renders as a DIRECT child')
    expect(said).toMatch(/already has a 'form-success'/)
  })
})

test.describe('the renderer owns its own data-* attributes', () => {
  test('an authored data-form-redirect cannot shadow the validated one', async () => {
    const s = await session()
    const home = await s.home()
    // `data-` is an open prefix, so this looked like an ordinary custom
    // attribute. It is the channel the published runtime navigates on, and a
    // duplicate attribute in HTML resolves to the FIRST occurrence — so an
    // authored one shadowed the exporter's, bypassing `isInternalRoute` and
    // handing a `javascript:` URL to location.assign on the published origin.
    const r = await s.call('edit_elements', {
      pageId: home.id,
      version: home.version,
      edits: [
        {
          ref: 'contact',
          form: { enabled: true, redirect: '/thanks' },
          attributes: { 'data-form-redirect': 'javascript:alert(document.domain)' },
        },
      ],
    })
    // refused by name, not silently dropped
    expect(JSON.stringify(r)).toContain('data-form-redirect')

    const html = await s.html()
    expect(html).not.toContain('javascript:')
    // exactly one redirect attribute, and it is the validated route
    expect(html.match(/data-form-redirect=/g)?.length).toBe(1)
    expect(html).toContain('data-form-redirect="/thanks"')
  })

  test('every renderer-owned data-* name is refused, ordinary ones still work', async () => {
    const s = await session()
    const home = await s.home()
    const r = await s.call('edit_elements', {
      pageId: home.id,
      version: home.version,
      edits: [
        {
          ref: 'contact',
          attributes: {
            'data-form': 'x',
            'data-fx': 'x',
            'data-int': 'x',
            'data-tgt': 'x',
            'data-slider': 'x',
            'data-node-id': 'x',
            // an author's own data attribute is none of our business
            'data-status': 'waiting',
          },
        },
      ],
    })
    const said = JSON.stringify(r)
    for (const name of [
      'data-form',
      'data-fx',
      'data-int',
      'data-tgt',
      'data-slider',
      'data-node-id',
    ]) {
      expect(said).toContain(name)
    }
    const html = await s.html()
    expect(html).toContain('data-status="waiting"')
    expect(html).not.toContain('data-int="x"')
    // the live one matters most: data-fx is the index into the effects manifest
    expect(html).not.toContain('data-fx="x"')
  })

  test('an externalAction is re-validated at export', async () => {
    const s = await session()
    const project = s.stored()
    // written straight into the blob, as an import or a merge would
    const walk = (nodes: { type: string; form?: unknown; children?: unknown[] }[]) => {
      for (const n of nodes) {
        if (n.type === 'form') n.form = { externalAction: 'javascript:alert(1)' }
        walk((n.children ?? []) as typeof nodes)
      }
    }
    for (const pg of project.pages) walk(pg.elements)
    const out = await s.exportWith(project, [])
    expect(out).not.toContain('javascript:')
    expect(out).not.toMatch(/<form[^>]*action=/)
  })
})

test.describe('publish warnings for forms', () => {
  test('an enabled form that would collect nothing is reported', async () => {
    const s = await mcpSession()
    const home = await s.home()
    // a form with no named field, no submit button and no success state
    await s.call('set_page_html', {
      pageId: home.id,
      version: home.version,
      html: pageHtml('<form data-ref="empty"><input /></form>'),
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'empty', form: { enabled: true } }],
    })
    expect(await s.kinds()).toContain('form-setup')
  })

  test('a well-built form is NOT reported', async () => {
    const s = await session()
    const home = await s.home()
    await s.call('edit_elements', {
      pageId: home.id,
      version: home.version,
      edits: [{ ref: 'contact', form: { enabled: true, name: 'Contact' } }],
    })
    expect(await s.kinds()).not.toContain('form-setup')
  })

  test('a plain form is never reported — it is a legitimate thing to build', async () => {
    const s = await session()
    expect(await s.kinds()).not.toContain('form-setup')
  })

  test('a form that is not enabled but holds named controls is reported', async () => {
    const s = await session()
    // it cannot leak (method="dialog"), but it reads to everyone else as "this
    // collects", so the decision belongs to a human: enable it, or drop the
    // <form> and build the mock from <div>/<label> groups
    expect(await s.kinds()).toContain('form-not-enabled-has-fields')

    // enabling it answers the question, so the warning goes
    const home = await s.home()
    await s.call('edit_elements', {
      pageId: home.id,
      version: home.version,
      edits: [{ ref: 'contact', form: { enabled: true, name: 'Contact' } }],
    })
    expect(await s.kinds()).not.toContain('form-not-enabled-has-fields')
  })

  test('a form with no named control is not reported', async () => {
    // a search box that links, or a shell waiting for its fields
    const s = await session('<form data-ref="shell"><button><span>Go</span></button></form>')
    expect(await s.kinds()).not.toContain('form-not-enabled-has-fields')
  })
})

test.describe('{{ENV.…}} in custom code', () => {
  test('a plain key is substituted and a secret one fails the publish', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<div data-type="text">x</div>'),
      version: home.version,
    })

    // with no integrations at all, a reference is simply unknown — and an
    // unknown reference must not ship as the literal text `{{ENV.X}}`
    const project = s.stored()
    project.settings.customCode = { head: '<script>var k="{{ENV.STRIPE_PUBLISHABLE_KEY}}"</script>' }
    await expect(s.exportWith(project, [])).rejects.toThrow(/not a key on any integration/)

    const integrations = [
      {
        id: 'i1',
        name: 'Stripe',
        fields: [
          { name: 'PUBLISHABLE_KEY', value: 'pk_live_ok', secret: false },
          { name: 'SECRET_KEY', value: 'sk_live_NEVER', secret: true },
        ],
      },
    ]
    const out = await s.exportWith(project, integrations)
    expect(out).toContain('var k="pk_live_ok"')
    expect(out).not.toContain('{{ENV.')

    // the secret one fails, and the message names the KEY and never the value
    const secret = s.stored()
    secret.settings.customCode = { head: '<script>var s="{{ENV.STRIPE_SECRET_KEY}}"</script>' }
    const err = await s.exportWith(secret, integrations).catch((e) => e as Error)
    expect((err as Error).message).toContain('STRIPE_SECRET_KEY')
    expect((err as Error).message).toContain('secret key')
    expect((err as Error).message).not.toContain('sk_live_NEVER')
  })
})
