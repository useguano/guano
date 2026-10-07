/** a reusable animation stored in the project library and shared across
 * elements — the "what happens" (classes + timing), reused by many bindings */
export interface Interaction {
  id: string
  name: string
  /** tailwind classes applied to the target while the interaction is active */
  toClasses: string
  duration: string // e.g. 'duration-300'
  easing: string // e.g. 'ease-out'
  /** while this effect is ON its target is a MODAL: page scroll locked, focus
   * moved in and trapped, `role="dialog"` + `aria-modal="true"` set, and all of
   * it reversed on OFF including focus back to whatever opened it. Pair it with
   * `closeOn: ['escape', 'outside']` — the flag adds the behaviours a native
   * <dialog> would give, to the overlay-built-from-classes model every project
   * already uses. */
  modal?: boolean
}

/** an element applying a saved interaction — the "when/where" (trigger +
 * target) is per-application, the animation is shared via interactionId */
/** what a trigger does to its target's state */
export type InteractionAction = 'toggle' | 'on' | 'off'

/** hover / scrolled / change are symmetric (they drive both directions and
 * ignore `action`); click is discrete and honours `action`; appear fires once
 * on scroll into view, and load does the same without waiting for the viewport */
export type InteractionTrigger =
  | 'hover'
  | 'click'
  | 'appear'
  | 'scrolled'
  | 'change'
  | 'load'

export interface InteractionBinding {
  id: string
  /** the saved Interaction (project.interactions) this applies */
  interactionId: string
  trigger: InteractionTrigger
  /** node the effect applies to; null = the trigger element itself.
   * `'@<name>'` is a CHANNEL (see lib/shared/interactionKeys.js): every element
   * declaring `channel: '<name>'` listens, wherever in the project it lives,
   * and the state key carries NO scope — a channel is site-wide by definition. */
  targetId: string | null
  /** breakpoint ids this application is active on; `undefined` = all (the
   * default). Stored in project breakpoint order; omitted when all are on so
   * untouched bindings stay byte-identical for merge signatures. */
  breakpoints?: string[]
  /** click only: force the effect on / off instead of toggling. Together with
   * state being keyed by (interaction, target) — see lib/shared/interactionKeys.js
   * — this is what makes an open button + a close button + an overlay work.
   * `undefined` = 'toggle'. */
  action?: InteractionAction
  /** gestures that force the effect OFF while it is on: a pointerdown outside
   * both the trigger and the target, and/or the Escape key. */
  closeOn?: ('outside' | 'escape')[]
  /** exclusive group: turning this effect on turns off every other effect in the
   * same group. Scoped per component instance but SHARED across a
   * collection-list's repeats, so "one accordion open at a time" works. */
  group?: string
  /** remember the effect's state so a dismissal sticks. Published site only —
   * the editor always shows the element so it stays authorable. */
  once?: 'session' | 'local'
  /** 'scrolled' only: px of page scroll past which the effect is on (default 50) */
  scrollAt?: number
}

/** a property the motion engine can tween. Units and neutral values live in
 * MOTION_PROPS (src/lib/shared/motion.js) — the single source of truth. */
export type AnimProp =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotate'
  | 'opacity'
  | 'blur'
  | 'brightness'
  | 'saturate'
  | 'bgColor'
  | 'textColor'
  | 'borderColor'
  | 'width'
  | 'height'
  | 'clipTop'
  | 'clipRight'
  | 'clipBottom'
  | 'clipLeft'
  | 'count'

/** one property's journey inside a step. `from` omitted = start from the
 * element's current computed value (measured at play time).
 * Values are a number (the property's default unit) or a string carrying one
 * — '110%', '1em', '50vw' — so a move can be relative to the element or the
 * viewport. Both sides of a tween must use the same unit. */
export interface AnimationTrack {
  prop: AnimProp
  from?: number | string
  to: number | string
  /** `count` only: how the number reads. The authored text is the FINAL value,
   * so this has to agree with it — `18,000+` is `{group: true, suffix: '+'}`. */
  format?: {
    decimals?: number
    /** thousands separators, in the route's locale */
    group?: boolean
    prefix?: string
    suffix?: string
  }
}

/** one segment of a timeline: a set of tracks sharing duration/easing */
export interface AnimationStep {
  id: string
  tracks: AnimationTrack[]
  /** milliseconds */
  duration: number
  /** key into EASINGS ('linear', 'ease-out', 'back-out'…) */
  easing: string
  /** ms from the previous step's END; negative overlaps. Omitted = 0. */
  offset?: number
  /** per-child delay (ms) when the target has children. Omitted = none.
   * Only the STAGGERED tracks move the children — unstaggered tracks in the
   * same step still move the element itself. */
  stagger?: number
  /** narrows a staggered step to matching descendants instead of direct
   * children (e.g. 'img'). Requires `stagger`. Published site + Preview only. */
  staggerSelector?: string
  /** extra iterations; -1 = forever. Omitted = play once. */
  repeat?: number
  /** reverse every other iteration. Omitted = false. */
  yoyo?: boolean
}

/**
 * ONE effect as the author sees it: a name, and up to one half of each engine.
 *
 * The two engines cannot be merged — a class change switches `display`, which no
 * tween can touch, and a tween writes inline styles, which no class can express
 * — but an author wanting "slide the sheet in" should not have to know that, nor
 * name two things and bind both on every trigger. So an Effect NAMES the pair,
 * and the halves stay where they are: `project.interactions` and
 * `project.animations`, bound exactly as before.
 *
 * Nothing downstream learns about it. The exporter, both published runtimes, the
 * merge and the MCP tools all still see two ordinary bindings, which is also why
 * an agent that writes the two halves separately gets the folded row for free:
 * a pair is RECOGNISED (same node, same trigger, same target, the two halves of
 * one Effect), never stored as a third kind of binding.
 */
export interface Effect {
  id: string
  name: string
  /** the class-change half, an id into project.interactions */
  interactionId?: string
  /** the timeline half, an id into project.animations */
  animationId?: string
}

/** a reusable timeline in the project library — the "what happens",
 * shared across elements exactly like Interaction */
export interface Animation {
  id: string
  name: string
  steps: AnimationStep[]
}

/** an element playing a saved Animation — the "when/where" */
export interface AnimationBinding {
  id: string
  /** the saved Animation (project.animations) this plays */
  animationId: string
  /** `scrolled` and `change` are symmetric like their class counterparts: the
   * timeline plays forward while the condition holds and rewinds when it stops */
  trigger: 'load' | 'appear' | 'scrub' | 'hover' | 'click' | 'scrolled' | 'change'
  /** node the animation moves; null = the trigger element itself.
   * `'@<name>'` is a CHANNEL — `click` only, because a click play is the one
   * tween key shared per (animation, target); every other trigger is keyed per
   * binding, and a scrub aimed at a shared overlay means nothing. */
  targetId: string | null
  /** click only: force the play forward ('on') or backward ('off') instead of
   * toggling it. Together with a click play being keyed by (animation, target)
   * — see animationStateKey in lib/shared/motion.js — this is what lets an open
   * button, a close button and an overlay drive ONE timeline, exactly as
   * InteractionBinding.action does for a class change.
   * `undefined` = 'toggle'. */
  action?: 'on' | 'off'
  /** 'scrolled' only: px of page scroll past which the timeline is played
   * forward, and below which it rewinds (default 50) */
  scrollAt?: number
  /** appear only. Omitted = inherit settings.motion.appearMode (default 'once'). */
  appearMode?: 'once' | 'replay' | 'reverse'
  /** appear only: the viewport fraction the element's top must cross before
   * firing (0.8 ≈ ScrollTrigger's 'top 80%'). Omitted = fire on first pixel. */
  appearAt?: number
  /** scrub only: viewport fractions the element's top travels between,
   * progress 0 → 1. Omitted = { start: 1, end: 0.25 }. */
  /** smooth: seconds the play lags scroll (exponential catch-up, published runtime) */
  scrub?: { start?: number; end?: number; smooth?: number }
  /** breakpoint ids this binding is active on; omitted = all (see
   * InteractionBinding — same byte-stability discipline) */
  breakpoints?: string[]
  /** ms the FORWARD play waits after its trigger fires before the timeline
   * starts — the knob that lets one library "pop in" serve every beat of a
   * sequence instead of one copy per start time. A reverse (hover-out,
   * click `off`, appear `reverse`) starts at once. Never on `scrub` (a scrub
   * has no moment to wait from). Omitted = 0; never stored as 0. During the
   * wait the element holds the timeline's FIRST frame, which is also what the
   * exporter bakes (see primeFirstFrame in lib/shared/motion.js). */
  delay?: number
}

export interface ElementNode {
  id: string
  type: string
  content?: string
  /** Tailwind classes applied in the canvas — single source of truth
   * for the Style panel, both its visual controls and the raw input */
  classes?: string
  /** saved interactions applied to this element (their effect may target another node) */
  interactions?: InteractionBinding[]
  /** saved animations played by this element (may target another node) */
  animations?: AnimationBinding[]
  /** custom HTML attributes (allowlisted; node-only state, like classes).
   * see lib/shared/attributes.sanitizeAttributes */
  attributes?: Record<string, string>
  /** html id attribute, set in the Data panel */
  htmlId?: string
  /** media source (data URL or remote) for image/video elements */
  src?: string
  /** icon only: the inline `<svg>` markup it renders — a bundled Lucide icon or
   * a custom SVG, ALWAYS the output of shared/svg.sanitizeInlineSvg. Node-only
   * state like `src`, and per-instance inside a component the same way. */
  svg?: string
  /** INSTANCE WRAPPER only (`:Button`): the option this instance picks per
   * variant axis, by name — `{ variant: 'outline', size: 'sm' }`. An axis left
   * out means the component's default, and a pick equal to the default is
   * never stored. */
  variants?: Record<string, string>
  /** MASTER node only: class overrides per variant option, keyed
   * `'<axis>:<option>'`. Layered over `classes` for an instance that picks the
   * option — later wins per property (see lib/variants). */
  variantClasses?: Record<string, string>
  /** not rendered and not exported. Node-only state, and per-instance inside a
   * component: an instance hides a part for itself, or — with an explicit
   * `false` — shows one its component hides by default. Omitted = inherit. */
  hidden?: boolean
  /** MASTER container only: a SLOT. The element itself is the component's
   * (classes, attributes, bindings, hidden — shared like any other master
   * node) but its CHILDREN belong to whoever placed the instance: on a page
   * they are ordinary page nodes, styled, restructured and addressed like any
   * other, and never realigned to the component. The master's own children
   * under it are the DEFAULT content a fresh instance is given, once. Carried
   * down onto mirrors and instance nodes like `arg`/`link`, so every tree
   * knows where the boundary is without consulting the master. */
  slot?: boolean
  /** this element LISTENS on a channel: any binding anywhere in the project
   * whose `targetId` is `'@<channel>'` drives it. Node state shared like
   * classes — on a master every instance listens, which is how the modal gets
   * to be a component. Site-wide by definition, so two listeners on one route
   * both open (the publish names that as `channel-declared-twice`), and a
   * listener inside a repeat is refused outright. */
  channel?: string
  /** background media (a /media/<id> URL) layered behind the element's content;
   * image → CSS background-image, video → an absolutely-positioned <video> layer.
   * node-only visual state like classes/src */
  background?: string
  /** per-locale overrides for editable content; base content/src is the default locale */
  locales?: Record<
    string,
    {
      content?: string
      src?: string
      /** per-locale ATTRIBUTE text — only the attributes a visitor reads
       * (placeholder, aria-label, alt, title), which otherwise render in the
       * default language on every locale route */
      attributes?: Record<string, string>
    }
  >
  /** navigation target for link elements — internal '/path' or absolute URL */
  link?: string
  /** field binding or collection name (the agent-facing HTML's `data-source`) */
  arg?: string
  /** client ref — a stable, human-readable address for this element, unique
   * per page. It is what an agent addresses (`data-ref` in the HTML) and the
   * strongest signal `applyHtml` adopts by. It emits NOTHING on the published
   * page — `htmlId` is the separate DOM id. */
  ref?: string
  /** collection-item only: the picked entry */
  entryId?: string
  /** collection-list only: filter → sort → limit applied to the entries it
   * repeats (node-only state, like classes; see shared/fields.applyListQuery) */
  listQuery?: {
    limit?: number
    /** skip the first N entries after sort, before limit (decouples slot
     * placement — hero/lead/stack — from the CMS schema) */
    offset?: number
    sortField?: string
    sortDir?: 'asc' | 'desc'
    filter?: {
      field: string
      equals?: string
      notEmpty?: boolean
      /** match the entry being rendered (a reference field pointing at it, or a
       * multi-reference holding it) — how a parent's page lists its children */
      equalsCurrent?: boolean
    }
    /** hand-picked entry ids to include; absent = all entries */
    pick?: string[]
    /** in entry scope (a collection template), drop the entry being viewed —
     * the "related posts / more from" pattern */
    excludeCurrent?: boolean
  }
  /**
   * Attribute values bound to collection fields: attribute name → field name,
   * resolved against the surrounding entry scope (shared/fields.resolveFieldAttrs).
   *
   * This is how presentation follows DATA. A `[field]` arg binds an element's
   * TEXT; this binds an attribute, which is the only way to reach a `data-*`
   * hook a `data-[status=waiting]:` class can style, or to pre-fill an input's
   * `value` / `placeholder` from the entry being edited. Without it a status
   * pill could not change colour per entry and every edit form rendered empty.
   *
   * Falls back to the static `attributes` value when there is no entry or the
   * field is empty, so a bound attribute is still authorable out of scope.
   */
  fieldAttrs?: Record<string, string>
  /**
   * Attribute overrides for THIS placement of a component, merged over the
   * master's `attributes` at render.
   *
   * `attributes` are shared like classes, which is right for `role` or `type` on
   * a one-purpose control and wrong for the text a visitor reads: two Input
   * instances need "Search contacts" and "Search", two icon buttons need
   * different aria-labels. Without this a component could not be reused for
   * either, so the Cocoapp prototype copied Input's class string onto plain
   * `:input:` elements and lost the component entirely.
   */
  instanceAttributes?: Record<string, string>
  /** slider only: carousel configuration (node-only state, like listQuery).
   * Absent = every default; see shared/slider.js */
  slider?: SliderConfig
  /** form only: does this form take submissions, and what happens when one
   * lands. Node-only state, per-instance with a component default like
   * `slider`/`listQuery` — a Newsletter component's form keeps its config at
   * the master and a placement can override it. Absent = a plain `<form>` with
   * no backend, which is what every form was before. See shared/forms.js */
  form?: FormConfig
  children: ElementNode[]
}

/**
 * What a `form` does with a submission.
 *
 * Deliberately NOT where the submission GOES: recipients, the mailer and the
 * webhook are server-side and admin-only (publish.json → `forms`). A form says
 * only *whether* it notifies, because the project blob is written by editors,
 * drafts, merges, contributors and agent tokens — a recipient field here would
 * let any of them quietly redirect other people's leads.
 */
export interface FormConfig {
  /** false or absent = a plain <form>, no endpoint, nothing stored */
  enabled?: boolean
  /** label in the submissions list and the notification subject */
  name?: string
  /** email the site's recipients (Settings → Forms) */
  notify?: boolean
  /** POST the validated submission to the site's webhook integration */
  forward?: boolean
  /** an internal route to send the visitor to on success; empty = show the
   * `form-success` block in place. Validated by `isInternalRoute` at write AND
   * against the manifest's routes at submit, so it can't become an open
   * redirect. */
  redirect?: string
  /** ESCAPE HATCH: post to a third party (Formspree, Web3Forms…) instead.
   * Mutually exclusive with `enabled` — nothing is stored or sent here, and
   * the publish warns that submissions leave the instance. */
  externalAction?: string
}

/** :slider configuration. Every field is optional — an absent config renders a
 * working carousel on SLIDER_DEFAULTS, and the Data panel prunes back to
 * absent so an untouched slider stays byte-identical for merge signatures. */
export interface SliderConfig {
  /** prev/next chrome, default true */
  arrows?: boolean
  /** pagination dots, default true */
  dots?: boolean
  /** slides visible at once, keyed 'base' (the widest breakpoint, applying
   * everywhere) plus breakpoint ids for narrower overrides — the desktop-first
   * model the class cascade uses. Values 1–8; entries equal to what they'd
   * inherit are pruned. */
  perView?: Record<string, number>
  /** space between slides in px, default 0 */
  gap?: number
  /** auto-advance, default false. Never runs under prefers-reduced-motion */
  autoplay?: boolean
  /** autoplay interval in ms, default 4000 */
  delay?: number
  /** wrap around at the ends, default false */
  loop?: boolean
  /** mouse drag (touch swipe is native scrolling either way), default true */
  drag?: boolean
}

export interface Breakpoint {
  id: string
  name: string
  width: number
  height: number
}

export interface Page {
  id: string
  name: string
  path: string
  status: string
  elements: ElementNode[]
  /** set when this page is a collection's template */
  collectionId?: string
  /** per-page SEO overrides (global defaults live in project.settings.seo) */
  seo?: { title?: string; description?: string }
  /** per-page custom JavaScript, injected (export-only) as <script> tags:
   * `head` at the top of the page, `body` before </body> */
  customCode?: { head?: string; body?: string }
  /** authorship/timestamps — stamped on create and on every content edit.
   * Optional so projects saved before tracking existed still load. */
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}

export interface CollectionField {
  id: string
  name: string
  type:
    | 'text'
    | 'number'
    | 'boolean'
    | 'select'
    | 'image'
    | 'date'
    | 'reference'
    | 'multi-reference'
    | 'multi-image'
  /** reference/multi-reference: the collection the field points into */
  refCollectionId?: string
  /** select only: the values an entry may hold, in the order the picker shows
   * them. The VALUE is what is stored and what `data-[…]` variants and
   * `listQuery.filter` match on, so it stays stable while the visible label
   * is whatever the page's own markup says — a status renders as a `<span>`
   * per option, not as the raw value, which is also how it gets translated. */
  options?: string[]
  /** text fields only: false marks the field non-translatable (label names,
   * catalog numbers, proper nouns) so the translation worklist skips it.
   * Absent/true = translatable. `number`, `boolean` and `select` are never
   * translatable by TYPE — a quantity and a stored key read the same in every
   * language — so the worklist skips them without needing the flag. */
  localize?: boolean
}

export interface CollectionEntry {
  id: string
  name: string
  /** entry's own slug segment; full path is /<collection>/<slug> */
  slug: string
  /** field name → value; reference = target entry id, multi-reference = ids.
   * References live only here (base) — they are never locale-overridden.
   * Scalars are all STRINGS, including `number` ("12") and `boolean`
   * ("true"/"false"): every consumer — the renderers, `resolveFieldAttrs`,
   * `applyListQuery`'s numeric-aware sort, a `data-[…]` variant — already
   * reads a string, and a second storage shape would be a branch in each. */
  values: Record<string, string | string[]>
  /** per-locale field overrides; base values is the default locale */
  locales?: Record<string, Record<string, string>>
  /** draft/published — an entry can now be held back independently of its
   * template page. Absent = 'published' (back-compat with older entries). */
  status?: string
  /** per-entry SEO overrides; falls back to the template page's SEO, then
   * the site defaults. Values may contain {field} tokens. */
  seo?: { title?: string; description?: string }
  createdAt: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}

export interface Collection {
  id: string
  /** lowercase slug used in the syntax: :collection-list[post] */
  name: string
  fields: CollectionField[]
  templatePageId: string
  entries: CollectionEntry[]
  /** false = a DATA-ONLY collection: rendered inside other pages, with no page
   * of its own. No template page is created, no entry routes are exported, and
   * an `@item` link to it is a diagnostic. Absent/true = a page per entry. */
  detailRoutes?: boolean
  /** path prefix for entry routes; defaults to the collection `name`. `''`
   * puts entries at the site root (`/<slug>`) — the WordPress-style layout a
   * real port often has to reproduce. */
  routeBase?: string
}

export interface CommentReply {
  id: string
  text: string
  /** display name of the author, captured at write time — a rename must not
   * rewrite history, and a deleted user's replies must still read correctly */
  author: string
  /** the author's user id, for "is this mine?" questions (unseen counts) */
  authorId?: string
  createdAt: number
}

/** anchors a comment to an element: a fractional position (0–1) within the
 * element's box, so the pin reflows/scales and resolves in any view that
 * renders the node (editor canvas + content preview).
 *
 * `breakpointId` is which canvas FRAME it was dropped in. Every frame renders
 * the same node ids, so without it the pin resolved to whichever frame came
 * first in the DOM — a comment left on the mobile layout was drawn on the
 * desktop one. Absent/null means "any frame" (a Play-surface comment, or one
 * written before this field existed), which still resolves to the first. */
export interface CommentAnchor {
  nodeId: string
  rx: number
  ry: number
  breakpointId?: string | null
}

export interface Comment {
  id: string
  pageId: string
  /** element anchor (new comments) — positions the pin from the node's live rect */
  anchor?: CommentAnchor
  /** legacy canvas position — breakpoint the comment is pinned in, or null for page */
  breakpointId?: string | null
  /** legacy canvas position: relative to the breakpoint frame, or world coords */
  x?: number
  y?: number
  text: string
  /** display name of the author, captured at write time (see CommentReply) */
  author: string
  /** the author's user id — an unseen count never counts your own comment */
  authorId?: string
  resolved: boolean
  createdAt: number
  replies: CommentReply[]
}

/**
 * One way a component's instances can differ in LOOK — `variant`
 * (default/outline/ghost), `size` (sm/md/lg). Style only: an option is a set of
 * class overrides on the master's nodes, never a different structure.
 *
 * Axes and options are addressed by NAME, in the document and by agents;
 * renaming one rewrites every use (lib/variantOps).
 */
export interface VariantAxis {
  name: string
  options: string[]
  /** the option an instance gets when it picks none */
  default: string
}

export interface ComponentDef {
  id: string
  /** Capitalized, unique — used as the :Name: syntax token */
  name: string
  /** master tree; node ids are the "master ids" instances override by */
  root: ElementNode
  /** drawer grouping; omitted = "Uncategorized" */
  category?: string
  /** the axes its instances can differ along. Written ONLY through
   * `setComponentMeta`, like the two keys above. */
  variants?: VariantAxis[]
}

export interface DesignToken {
  id: string
  /** kebab-case, becomes bg-<name>/text-<name>/border-<name> */
  name: string
  /** hex color */
  value: string
}

export type PublishMethod = 'server' | 'zip' | 'github'

export type StructuredDataType = 'Organization' | 'Person' | 'LocalBusiness'

/** the authored half of the site's structured data; the graph itself is built at export */
export interface StructuredDataSettings {
  type: StructuredDataType
  /** social profile URLs (sameAs) */
  sameAs?: string[]
  /** raw JSON-LD (one object or an array) appended to the generated graph */
  custom?: string
}

export interface ProjectSettings {
  /** data URL; extracted to a file at publish */
  favicon?: string
  /** the dark-mode variant, served with media="(prefers-color-scheme: dark)" */
  faviconDark?: string
  /** how the header Publish button ships the site. github config here is
   * NON-secret — the token lives server-side only (server/data/publish.json).
   *
   * `apiOrigin` is where a published page reaches THIS instance for the
   * server-backed features (form submissions). Empty means "the same host",
   * which is what the `server` method is; a zip or GitHub export is served from
   * somewhere else, so it has to carry the studio's public origin. It lives in
   * `publishing` because that namespace is already refused to contributors and
   * agent tokens (protectedFieldDelta) — an injected agent must not be able to
   * redirect a site's submissions. */
  publishing: {
    method: PublishMethod
    github: { repo: string; branch: string }
    apiOrigin?: string
  }
  seo: {
    siteName: string
    /** '%s' = page name */
    titleTemplate: string
    description: string
    ogImage?: string
    /** the site logo (data URL / media path) — the identity's `logo` (or a Person's `image`) in structured data */
    logo?: string
    /** schema.org JSON-LD emitted on every route (shared/structuredData.js) */
    schema?: StructuredDataSettings
  }
  /** bare domain (example.com) — canonical/og URLs in exports when set */
  domain: string
  /** DEPRECATED — an integration is a named set of keys now, stored entirely
   * server-side in server/data/integrations.json and reached over
   * /api/integrations. Nothing reads either field; `migrateIntegrations` (in
   * server/index.mjs) carries a configured value across at boot and then
   * deletes it from every blob. Kept optional so a blob written before that
   * boot still type-checks. Never add a reader. */
  smtp?: { host: string; port: string; user: string; password: string; from: string }
  /** DEPRECATED — see `smtp` above. */
  integrations?: {
    stripe: { publishableKey: string }
    mailing: { provider: string }
  }
  /** Tailwind theme tokens (colors) */
  tokens: DesignToken[]
  /** the project's own type / spacing scale, compiled into the same @theme
   * block as the colour tokens. A design system usually sets its own root size
   * and type ramp; without this a project could only approximate its own scale.
   * `rootFontSize` becomes an `html { font-size }` rule in the export (exact);
   * in the editor it is applied to the site scope so it can't rescale the
   * editor's own chrome. Values are validated as CSS lengths (isThemeValue). */
  theme?: {
    rootFontSize?: string
    /** the whole spacing scale: v4 derives it as calc(--spacing * n) */
    spacing?: string
    /** step name → value, e.g. `{ base: '.875rem', '2xl': '2rem' }` */
    text?: Record<string, string>
    leading?: Record<string, string>
    tracking?: Record<string, string>
    radius?: Record<string, string>
  }
  /** site-wide motion, all of it optional and off by default. Applies to the
   * Preview surface and the published site — never the Build canvas, which
   * pans instead of scrolling and is an editing surface, not a rendering of
   * the site. Every part of it yields to `prefers-reduced-motion` and ?noanim.
   * Resolution + validation live in lib/shared/motion.js so the exporter, the
   * editor and the MCP agree on what a given object means. */
  motion?: {
    /** what an appear-triggered animation does on re-entry and exit, for
     * bindings that don't set their own appearMode. Omitted = 'once'. */
    appearMode?: 'once' | 'replay' | 'reverse'
    /** outgoing/incoming animations played on the page body around a
     * same-origin navigation */
    transitions?: {
      enabled: boolean
      /** a TRANSITION_PRESETS id, or 'custom' to use the two ids below.
       * Omitted = 'fade'. */
      preset?: string
      /** enter duration in ms; exit runs at TRANSITION_DEFAULTS.exitRatio */
      duration?: number
      /** key into EASINGS */
      easing?: string
      /** 'custom' preset only: timelines from project.animations */
      exitAnimationId?: string
      enterAnimationId?: string
    }
    /** inertia ("lerped") scrolling. Off on touch and reduced-motion; scrolls
     * the real scroll position rather than transforming a wrapper, so the
     * `scrolled` interaction trigger and position:fixed keep working. */
    scroll?: { enabled: boolean; lerp?: number }
  }
  /** raw HTML injected into exported <head> */
  /** raw HTML: `head` goes into every exported <head>, `body` before every </body> */
  customCode: { head: string; body?: string }
  fonts: {
    family: string
    monoFamily?: string
    serifFamily?: string
    googleFontsUrl?: string
    /** webfonts hosted in this project's media library, emitted as @font-face
     * on every surface (editor, preview, export) — see lib/shared/fonts.js */
    custom?: CustomFont[]
  }
}

/** one @font-face: a family name pointing at a font file in the media library */
export interface CustomFont {
  id: string
  /** the font-family name to reference in styles, e.g. "OffSans" */
  family: string
  /** '/media/<id>' (library asset) or an https:// URL */
  src: string
  /** the format() hint — derived from the asset's mime when picked */
  format?: string
  /** '400', 'bold', or a variable range like '100 900'; default normal */
  weight?: string
  style?: 'normal' | 'italic'
}

export interface Project {
  id: string
  name: string
  /**
   * The stored shape. v2 (`lib/migrate.ts`) is the one where the ElementNode
   * tree is the only source of truth; v1 carried the indentation DSL beside
   * it. Absent means v1 — a blob written before the migration existed.
   */
  schemaVersion?: number
  pages: Page[]
  components: ComponentDef[]
  collections: Collection[]
  /** shared interaction library — applied to elements by id */
  interactions: Interaction[]
  /** shared animation library — played by elements by id */
  animations: Animation[]
  /** names a class change and a timeline as ONE effect (see Effect). Optional
   * and absent until something needs it, so an untouched project stays
   * byte-identical for the merge signature. */
  effects?: Effect[]
  /** shared across all pages — they map to global CSS media queries */
  breakpoints: Breakpoint[]
  comments: Comment[]
  /** registered locale codes; always contains defaultLocale */
  locales: string[]
  /** the locale that base content/src/values belong to */
  defaultLocale: string
  settings: ProjectSettings
}
