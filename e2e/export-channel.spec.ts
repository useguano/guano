import { test, expect } from '@playwright/test'
import {
  animTargetKeys,
  classTriggers,
  listenKeys,
  manifest,
  motionTriggers,
  triggerStateKeys,
} from './fixtures/fxWire'
// In-process, on the shared harness (e2e/fixtures/mcpSession.ts) — no server,
// no browser, no login, so this spec sorts anywhere.
import { mcpSession, pageHtml as page } from './fixtures/mcpSession'

// A CHANNEL is a target that is a NAME: a binding sets `targetId: "@start"`
// and any element declaring `channel: "start"` listens, wherever it lives.
// That is what lets ONE modal be opened from a header component on every
// route — a node id addresses one tree, and a master's binding keys per
// instance, so before this the overlay had to live inside whatever opened it.
//
// THE LOAD-BEARING RULE: a channel target is UNSCOPED. No component instance,
// no entry. Everything here reads the EXPORTED HTML, because the bug this
// guards against is a key the trigger writes and the listener never listens
// on — which both the tool and the publish report as success.

const triggerKeys = triggerStateKeys
const fxMap = (html: string): Record<string, string> => manifest(html).fx ?? {}

type Node = { id: string; type: string }

/** a project with a Header component (opens @start) and a StartModal
 *  component (listens on it) — the two live in different trees on purpose */
async function withHeaderAndModal() {
  const s = await mcpSession()
  const fx = await s.call('create_interactions', { items: [{ name: 'Show', toClasses: 'flex' }] })
  const showId: string = fx.created[0].id

  // the modal FIRST: a binding is refused until something listens
  const modal = await s.call('create_component', {
    name: 'StartModal',
    html: '<div class="fixed inset-0 hidden items-center justify-center"><p>Welcome</p></div>',
  })
  const panel = modal.nodes.find((n: Node) => n.type === 'div')
  const declared = await s.call('edit_elements', {
    componentId: modal.componentId,
    edits: [{ id: panel.id, channel: 'start' }],
  })
  expect(declared.failed).toBe(0)

  const header = await s.call('create_component', {
    name: 'Header',
    html: '<header class="flex"><button><span>Open</span></button></header>',
  })
  const trigger = header.nodes.find((n: Node) => n.type === 'button')
  const bound = await s.call('edit_elements', {
    componentId: header.componentId,
    edits: [
      {
        id: trigger.id,
        bindInteractions: [{ interactionId: showId, trigger: 'click', channel: 'start' }],
      },
    ],
  })
  expect(bound.failed).toBe(0)

  return { s, showId, modalId: modal.componentId, headerId: header.componentId }
}

test('a component opens a modal component, on every route, with one unscoped key', async () => {
  const { s, showId } = await withHeaderAndModal()
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    version: home.version,
    html: page('<Header />\n<StartModal />'),
  })
  await s.call('create_page', { name: 'About', slug: '/about' })
  const about = (await s.call('list_pages', {})).pages.find(
    (p: { slug?: string; path?: string }) => (p.slug ?? p.path) === '/about',
  )
  await s.call('set_page_html', {
    pageId: about.id,
    version: about.version,
    html: page('<Header />\n<StartModal />'),
  })

  const routes = await s.exportAll()
  for (const route of ['index.html', 'about/index.html']) {
    const html = routes[route]!
    const keys = triggerKeys(html)
    // ONE key for the whole channel, and the key the trigger writes IS the key
    // the modal listens on. The published keys are route-local ordinals, so
    // "unscoped" is asserted as the consequence it has: one key, matched on
    // both sides, on every route. (The next test covers two openers sharing it,
    // which is what an '@instance' scope would break.)
    expect(keys).toHaveLength(1)
    expect(listenKeys(html)).toContain(keys[0])
    expect(fxMap(html)[keys[0]!]).toBe('flex')
    expect(showId).toBeTruthy()
  }
})

test('a second component binding the same channel shares the key', async () => {
  const { s, showId } = await withHeaderAndModal()
  const footer = await s.call('create_component', {
    name: 'Footer',
    html: '<footer class="flex"><button><span>Close</span></button></footer>',
  })
  const close = footer.nodes.find((n: Node) => n.type === 'button')
  const bound = await s.call('edit_elements', {
    componentId: footer.componentId,
    edits: [
      {
        id: close.id,
        bindInteractions: [
          { interactionId: showId, trigger: 'click', channel: 'start', action: 'off' },
        ],
      },
    ],
  })
  expect(bound.failed).toBe(0)

  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    version: home.version,
    html: page('<Header />\n<StartModal />\n<Footer />'),
  })

  const html = await s.html()
  // two triggers in two different components, ONE effect
  const keys = triggerKeys(html)
  expect(keys).toHaveLength(2)
  expect(new Set(keys).size).toBe(1)
  expect(new Set(listenKeys(html))).toEqual(new Set(keys))
  // and the second one aims the shared effect the other way
  expect(classTriggers(html).map((meta) => meta.a)).toContain('off')
  expect(showId).toBeTruthy()
})

test('a click tween reaches a channel and every other trigger is refused by name', async () => {
  const { s, headerId } = await withHeaderAndModal()
  const made = await s.call('create_animations', {
    items: [
      {
        name: 'Rise',
        steps: [{ tracks: [{ prop: 'y', from: 20, to: 0 }], duration: 300, easing: 'ease-out' }],
      },
    ],
  })
  expect(made.failures ?? []).toEqual([])
  const animId: string = made.created[0].id
  const header = (await s.call('list_components', { includeNodes: true })).components.find(
    (c: { name: string }) => c.name === 'Header',
  )
  const trigger = header.nodes.find((n: Node) => n.type === 'button')

  // every trigger but click is keyed per BINDING, so two triggers aimed at
  // one channel would run two timelines on the same element
  const appear = await s.call('edit_elements', {
    componentId: headerId,
    edits: [
      {
        id: trigger.id,
        bindAnimations: [{ animationId: animId, trigger: 'appear', channel: 'start' }],
      },
    ],
  })
  expect(appear.failed).toBe(1)
  expect(JSON.stringify(appear.failures)).toMatch(/cannot target a channel/)

  const click = await s.call('edit_elements', {
    componentId: headerId,
    edits: [
      {
        id: trigger.id,
        bindAnimations: [{ animationId: animId, trigger: 'click', channel: 'start' }],
      },
    ],
  })
  expect(click.failed).toBe(0)
  const bindingId: string = click.bound[0].animationBindingIds[0]

  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    version: home.version,
    html: page('<Header />\n<StartModal />'),
  })
  const html = await s.html()
  // the tween listener is matched by the BINDING key, unscoped on both sides.
  // The published keys are route-local ordinals, so what is asserted is the
  // relationship: the key the trigger declares is one some element receives.
  const metas = motionTriggers(html)
  expect(metas).toHaveLength(1)
  expect(animTargetKeys(html)).toContain(metas[0]!.k)
  expect(bindingId).toBeTruthy()
  // …and a click also carries a PLAY key, distinct from its binding key: that
  // is the one shared per (animation, target), which is what lets an open
  // button, a close button and the overlay drive ONE timeline
  expect(metas[0]!.s).toBeTruthy()
  expect(metas[0]!.s).not.toBe(metas[0]!.k)
  expect(animId).toBeTruthy()
})

test('a listener inside a repeat, on a wrapper, or declared twice is reported', async () => {
  const { s } = await withHeaderAndModal()
  const c = (await s.call('create_collection', { name: 'post', detailRoutes: false })).collection
  await s.call('upsert_entries', { collectionId: c.id, entries: [{ name: 'One' }] })

  const home = await s.home()
  const written = await s.call('set_page_html', {
    pageId: home.id,
    version: home.version,
    html: page(
      [
        '<Header />',
        '<collection-list source="post">',
        '  <div data-ref="row" />',
        '</collection-list>',
        '<StartModal data-ref="shell" />',
      ].join('\n'),
    ),
  })

  // inside a repeat: it would open once per row
  const inRepeat = await s.call('edit_elements', {
    pageId: home.id,
    version: written.version,
    edits: [{ ref: 'row', channel: 'row-sheet' }],
  })
  expect(inRepeat.failed).toBe(1)
  expect(JSON.stringify(inRepeat.failures)).toMatch(/once per row/)

  // on an instance wrapper: it emits no element, so the classes land nowhere
  const onWrapper = await s.call('edit_elements', {
    pageId: home.id,
    version: written.version,
    edits: [{ ref: 'shell', channel: 'other' }],
  })
  expect(onWrapper.failed).toBe(1)
  expect(JSON.stringify(onWrapper.failures)).toMatch(/emits no element/)

  // two listeners on one route: both open, so the overlay shows twice
  await s.call('set_page_html', {
    pageId: home.id,
    version: (await s.home()).version,
    html: page('<Header />\n<StartModal />\n<StartModal />'),
  })
  expect(await s.kinds()).toContain('channel-declared-twice')
})

test('a binding with no listener is refused, and a bad name is not a node id', async () => {
  const s = await mcpSession()
  const fx = await s.call('create_interactions', { items: [{ name: 'Show', toClasses: 'flex' }] })
  const home = await s.home()
  const written = await s.call('set_page_html', {
    pageId: home.id,
    version: home.version,
    html: page('<button data-ref="open"><span>Open</span></button>'),
  })

  const dead = await s.call('edit_elements', {
    pageId: home.id,
    version: written.version,
    edits: [
      {
        ref: 'open',
        bindInteractions: [{ interactionId: fx.created[0].id, trigger: 'click', channel: 'start' }],
      },
    ],
  })
  expect(dead.failed).toBe(1)
  expect(JSON.stringify(dead.failures)).toMatch(/no element listens on channel/)

  const bad = await s.call('edit_elements', {
    pageId: home.id,
    version: written.version,
    edits: [
      {
        ref: 'open',
        bindInteractions: [
          { interactionId: fx.created[0].id, trigger: 'click', targetId: '@Start Modal' },
        ],
      },
    ],
  })
  expect(bad.failed).toBe(1)
  expect(JSON.stringify(bad.failures)).toMatch(/is not a channel name/)
})

test('a channel bound but listened to nowhere published is a publish warning', async () => {
  const { s } = await withHeaderAndModal()
  const home = await s.home()
  // the Header ships; the modal that declares the channel does not
  await s.call('set_page_html', {
    pageId: home.id,
    version: home.version,
    html: page('<Header />'),
  })
  const kinds = await s.kinds()
  expect(kinds).toContain('binding-target-unreachable')
})

// The hole that let a dead modal publish while every tool reported success:
// `edit_elements`' wrapper refusal deliberately exempts the master ROOT (it
// legitimately takes classes, a background, an arg), and nothing else in the
// channel branch tested for it. The root emits no element of its own, so the
// listener's `data-tgt` had nowhere to land — and because `channelListeners`
// walks `[component.root]`, the root counted as a listener for the bind check
// AND for publish's reachability warning. The HTML writer, the Data panel and
// validateTree all already refused it.
test('a channel on a component MASTER ROOT is refused, by name', async () => {
  const s = await mcpSession()
  const modal = await s.call('create_component', {
    name: 'Sheet',
    html: '<div class="fixed inset-0 hidden"><p>Hi</p></div>',
  })
  const root = modal.nodes.find((n: Node & { root?: boolean }) => n.root)
  const bad = await s.call('edit_elements', {
    componentId: modal.componentId,
    edits: [{ id: root.id, channel: 'sheet' }],
  })
  expect(bad.failed).toBe(1)
  expect(JSON.stringify(bad.failures)).toMatch(/emits no element of its own/)
  // and it names where it DOES belong — the element the classes land on
  expect(JSON.stringify(bad.failures)).toMatch(/INSIDE Sheet/)
  expect(s.stored().components[0].root.channel).toBeUndefined()

  // the element inside takes it
  const panel = modal.nodes.find((n: Node & { root?: boolean }) => n.type === 'div' && !n.root)
  expect(
    (
      await s.call('edit_elements', {
        componentId: modal.componentId,
        edits: [{ id: panel.id, channel: 'sheet' }],
      })
    ).failed,
  ).toBe(0)
})

// The other half of the same bug, in the exporter: renderNode's "bare wrapper"
// early return happens BEFORE attrsFor, so everything that call would have
// written for the wrapper is discarded without a word. Its predicate tested own
// classes, the master's background and the master's declared interactions —
// not a channel, not animations, and not "is anything aimed at this". A
// listener on a non-bare root worked and the same listener on a bare one did
// not, so adding one class to the root "fixed" the modal.
test('a wrapper that is a listener or a target still emits its element', async () => {
  const { s, showId, headerId } = await withHeaderAndModal()
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    version: home.version,
    html: page('<Header />\n<StartModal />'),
  })
  const html = await s.html()
  // the StartModal wrapper is bare (no classes of its own) — its CHILD is the
  // listener, and that child's data-tgt must be on the route
  const declared = triggerKeys(html)
  expect(declared).toHaveLength(1)
  // the listener carries the one key the trigger writes, and the route's fx
  // table has the classes for it — a bare wrapper used to drop both
  expect(listenKeys(html)).toEqual([declared[0]])
  expect(Object.keys(fxMap(html))).toContain(declared[0])
  expect(showId).toBeTruthy()

  // now put the listener's own channel aside and make the WRAPPER the target of
  // an ordinary in-master binding: the wrapper has no classes, so the old
  // predicate judged it bare and dropped the data-tgt it should carry
  const fx = await s.call('create_interactions', { items: [{ name: 'Lift', toClasses: 'opacity-100' }] })
  const liftId: string = fx.created[0].id
  const headerComp = (await s.call('list_components', { names: ['Header'], includeNodes: true }))
    .components[0]
  const btn = headerComp.nodes.find((n: Node) => n.type === 'button')
  const headerRoot = headerComp.nodes.find((n: Node & { root?: boolean }) => n.root)
  const bound = await s.call('edit_elements', {
    componentId: headerId,
    edits: [
      {
        id: btn.id,
        bindInteractions: [{ interactionId: liftId, trigger: 'click', targetId: headerRoot.id }],
      },
    ],
  })
  expect(bound.failed).toBe(0)
  const after = await s.html()
  // the Header wrapper is the target, so the route must list a SECOND state
  // key — the channel's, plus the one this in-master binding just added
  expect(new Set(listenKeys(after)).size).toBe(2)
  expect(Object.keys(fxMap(after))).toHaveLength(2)
  expect(Object.values(fxMap(after))).toContain('opacity-100')
  expect(liftId).toBeTruthy()
})
