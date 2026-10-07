// Static-site exporter: turns a published project snapshot into plain
// HTML files + one compiled CSS + a tiny interaction runtime. Pure JS —
// no Vue; rendering semantics mirror src/components/site/PublicRenderer.vue
// (the SPA dev preview), which is the source of truth for behavior.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withStagingDir } from './util.mjs'
import { compile, optimize } from '@tailwindcss/node'
// Element registry shared verbatim with the client (src/lib/elements.ts
// re-exports this same module) — one source of truth, no drift.
import { ELEMENTS_DATA as ELEMENTS } from '../src/lib/shared/elements.js'
import { themeBlock, rootFontSizeCss, applyTitleTemplate } from '../src/lib/shared/tokens.js'
import { PROSE_CSS, CUSTOM_VARIANTS } from '../src/lib/shared/prose.js'
import { fontFaceBlock } from '../src/lib/shared/fonts.js'
import { buildStructuredData, structuredDataTag } from '../src/lib/shared/structuredData.js'
import {
  resolveBinding,
  resolveListScope,
  refDisplay,
  applyListQuery,
  mediaUrls,
  resolveFieldAttrs,
} from '../src/lib/shared/fields.js'
import {
  resolveNodeAttributes,
  sanitizeAttributes,
  serializeAttribute,
  splitLinkAttributes,
  withSafeRel,
} from '../src/lib/shared/attributes.js'
import { isRich, rewriteRichMedia, sanitizeRich } from '../src/lib/shared/richtext.js'
import { backgroundRender, backgroundKindFromUrl } from '../src/lib/shared/background.js'
import { DEFAULT_ICON_SVG, parseInlineSvg, sanitizeInlineSvg } from '../src/lib/shared/svg.js'
import {
  buildInstanceMap,
  isBareWrapper,
  isNodeHidden,
  resolveInstanceValue,
} from '../src/lib/shared/instances.js'
import { conflictingBaseClasses } from '../src/lib/shared/interactionClasses.js'
import { buildScopeRoots, entryScopePart, bindingScope } from '../src/lib/shared/entryScope.js'
import {
  DEFAULT_SCROLL_AT,
  interactionGroupKey,
  interactionStateKey,
  isChannelName,
  isChannelTarget,
} from '../src/lib/shared/interactionKeys.js'
import { buildChannelIndex } from '../src/lib/shared/channels.js'
import {
  animationStateKey,
  compileAnimation,
  splitByStagger,
  initialStyle,
  primeFirstFrame,
  bindingDelay,
  effectiveAppearMode,
  resolveTransition,
  resolveScrollLerp,
  TRANSITION_EXIT_ID,
  TRANSITION_ENTER_ID,
} from '../src/lib/shared/motion.js'
import {
  resolveSliderConfig,
  sliderTrackClasses,
  sliderWireData,
  sliderHostExtraClass,
  sliderCandidateClasses,
  resolveSliderLabels,
  sliderDotLabel,
  SLIDER_LABEL_ATTRS,
  SLIDER_SLIDE_CLASSES,
  SLIDER_ARROW_CLASSES,
  SLIDER_PREV_CLASS,
  SLIDER_NEXT_CLASS,
  SLIDER_PREV_SVG,
  SLIDER_NEXT_SVG,
  SLIDER_DOTS_CLASSES,
} from '../src/lib/shared/slider.js'
import { SAFE_HREF, SAFE_SRC } from '../src/lib/shared/urls.js'
import {
  collectFormFields,
  formEnabled,
  formName,
  isInternalRoute,
  FORM_STATE_TYPES,
  HONEYPOT_CLASS,
  HONEYPOT_CSS,
} from '../src/lib/shared/forms.js'
import { envLookup, substituteEnvRefs } from '../src/lib/shared/integrations.js'
import { slugify, entrySlug, entryRoutePath, collectionRouteBase, hasDetailRoutes } from '../src/lib/shared/slug.js'
import { walkNodes } from './util.mjs'
import { extractMedia } from './export-media.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUNTIME = join(ROOT, 'server', 'site-runtime.js')
// built from src/motion/runtime.ts by `npm run build:motion` (committed)
const MOTION_RUNTIME = join(ROOT, 'server', 'motion-runtime.js')
// built from src/slider/runtime.ts by `npm run build:slider` (committed)
const SLIDER_RUNTIME = join(ROOT, 'server', 'slider-runtime.js')

// SiteView.vue wrapper / PublicRenderer body classes (keep in sync)
// the published <body> IS the page's body node — its classes are user-owned.
// The old shell defaults live in @layer base instead, so any utility the
// user puts on body (bg-*, text-*, …) wins by layer order, never by luck.
const SANS_STACK =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
function baseBodyCss(settings) {
  const family = settings?.fonts?.family
  const safe = family && /^[\w\s,'"-]+$/.test(family) ? family : null
  // the custom family gets the full fallback stack appended (a missing webfont
  // degrades sensibly), matching the --font-sans binding in themeBlock
  return (
    '@layer base{body{display:flex;min-height:100vh;flex-direction:column;' +
    `background-color:#fff;color:#000;font-family:${safe ? `${safe}, ${SANS_STACK}` : SANS_STACK};}}\n`
  )
}
const NOTFOUND_CLASSES =
  'flex flex-1 flex-col items-center justify-center gap-2 text-4xl font-semibold text-sm text-neutral-500'

// project-settings helpers shared verbatim with the client
// (src/lib/settings.ts re-exports these) — token validation, the @theme
// builder and the title template

// ---------- tiny helpers ----------

/** slugify each path segment so a user-typed slug/locale/name can't escape
 * the output dir (`..` → '' → dropped) while legitimate nesting survives */
const safePath = (path) => String(path ?? '').split('/').map(slugify).filter(Boolean).join('/')

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** A bare hostname, validated HERE rather than only on the settings write path:
 * `settings.domain` reaches this file from the stored project blob, which a
 * contributor can PUT directly (domain is not one of the sensitive fields), so
 * the renderer must not trust it. Anything malformed is treated as "no domain"
 * — canonical/og:image simply stay relative instead of carrying a poisoned
 * absolute URL. (S16) */
const EXPORT_HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** decode the standard HTML entities ONCE. Content accepts HTML, so stored
 * text like "Inès &amp; Jonas" means "Inès & Jonas" — escaping the raw string
 * double-escaped it to "&amp;amp;" on screen. `&amp;` decodes LAST so
 * "&amp;lt;" round-trips to a literal "&lt;" (one decode, exactly). */
function decodeEntities(value) {
  const cp = (n) => {
    try {
      return String.fromCodePoint(n)
    } catch {
      return ''
    }
  }
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => cp(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => cp(parseInt(n, 16)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
}

// ---------- locale reads (mirror src/composables/useLocale.ts) ----------

const nodeContent = (node, locale, def) =>
  (locale !== def && node.locales?.[locale]?.content) || node.content

const nodeSrc = (node, locale, def) => (locale !== def && node.locales?.[locale]?.src) || node.src

/** the ATTRIBUTES a node renders on this route: the master's (shared, like
 * classes), each host mirror's say about the instance it holds, this
 * placement's own overrides, then the locale's text overrides. Mirrors
 * useRenderNode's customAttrs through the same shared helper. */
const nodeAttributes = (node, mapping, locale, def) =>
  resolveNodeAttributes(
    node,
    mapping,
    locale !== def ? node.locales?.[locale]?.attributes : undefined,
  )

// reference fields store ids (possibly arrays) — those never read as text
const baseEntryText = (entry, name) =>
  typeof entry.values[name] === 'string' ? entry.values[name] : undefined

// takes the FIELD (not just its name): a field flagged localize:false always
// renders its base value — stored overrides (written before the flag flipped)
// used to render anyway while the worklist hid them, so the drift was invisible
const entryValue = (entry, field, locale, def) => {
  const name = typeof field === 'string' ? field : field.name
  const localizable = typeof field === 'string' || field.localize !== false
  return (
    (localizable && locale !== def && entry.locales?.[locale]?.[name]) ||
    baseEntryText(entry, name)
  )
}

// ---------- variants ----------

// Turning an instance's variant picks into classes needs the full style
// catalog, which is TypeScript — so it comes from the committed editor-logic
// bundle, the same one the server seeds projects from. Loaded only for a
// project that actually uses variants, and resolved for both layouts (the
// repo, and the packed npm package).
let effectiveClasses = null
async function loadVariants() {
  if (effectiveClasses) return
  try {
    const mod = await import(
      new URL('../packages/guano/runtime/mcp-runtime.mjs', import.meta.url).href
    ).catch(() => import(new URL('../runtime/mcp-runtime.mjs', import.meta.url).href))
    effectiveClasses = mod.effectiveClasses
  } catch {
    // swallowed: reported below, with what to do about it
  }
  if (typeof effectiveClasses !== 'function') {
    effectiveClasses = null
    throw new Error(
      'editor-logic bundle missing — this project uses component variants, which the ' +
        'exporter resolves with it. Run `npm run build:mcp-runtime`.',
    )
  }
}

function usesVariants(project) {
  let found = false
  for (const component of project.components ?? []) {
    walkNodes([component.root], (n) => {
      if (n.variantClasses) found = true
    })
  }
  return found
}

/** the classes a node wears: the master's inside an instance, with the
 * instance's variant options layered on */
function ownClasses(node, mapping) {
  if (!mapping) return node.classes ?? ''
  if (!mapping.master.variantClasses || !effectiveClasses) return mapping.master.classes ?? ''
  return effectiveClasses(mapping.master, mapping.def, mapping.picks)
}

// ---------- component master pairing ----------

// the SAME walk the editor's masterMap runs (shared/instances.js) — it used to
// be mirrored here by hand
const buildMasterMap = (elements, components) => buildInstanceMap(elements, components ?? [])

// ---------- interactions ----------

/**
 * Plain (non-component) interaction index for a route, built from every
 * tree the route actually renders (the page plus template trees pulled
 * in by collection-item embeds) — a deliberate improvement over the
 * SPA's activePage-only index.
 * Returns Map<targetNodeId, Interaction[]>.
 */
function buildPlainTargets(page, project) {
  const index = new Map()
  for (const { tree } of routeTrees(page, project)) {
    walkNodes(tree, (owner) => {
      for (const i of owner.interactions ?? []) {
        const key = i.targetId ?? owner.id
        if (!index.has(key)) index.set(key, [])
        // the OWNER travels with the binding: the state key's entry scope is
        // decided by where the owner sits relative to the target (see attrsFor)
        index.get(key).push({ i, ownerId: owner.id })
      }
    })
  }
  return index
}

/**
 * Every tree a route renders: the page, plus the template body of each
 * `collection-item` embed. `root` labels where a tree came from, which is what
 * buildScopeRoots keys the template's nodes under.
 */
function routeTrees(page, project) {
  const trees = [{ tree: page.elements, root: null }]
  walkNodes(page.elements, (n) => {
    if (n.type === 'collection-item' && n.arg) {
      const col = project.collections.find((c) => c.name === n.arg)
      const tpl = col && project.pages.find((p) => p.id === col.templatePageId)
      const body = tpl?.elements.find((b) => b.type === 'body')
      if (body) trees.push({ tree: body.children, root: `tpl:${tpl.id}` })
    }
  })
  return trees
}

/**
 * The route's entry-scope index (shared/entryScope.js): the page's trees plus
 * every component master, since a master can hold a `:collection-list` of its
 * own and its nodes are keyed by the same ids.
 */
function routeScopeRoots(page, project) {
  return buildScopeRoots([
    ...routeTrees(page, project),
    ...(project.components ?? []).map((c) => ({ tree: [c.root], root: null })),
  ])
}

/**
 * Animation bindings reachable from a route, indexed by the node each one
 * MOVES. Same shape and reasoning as buildPlainTargets (above) — the tween
 * system mirrors the class system's trigger/target split.
 * Returns Map<targetNodeId, AnimationBinding[]>.
 */
function buildPlainAnimTargets(page, project) {
  const index = new Map()
  for (const { tree } of routeTrees(page, project)) {
    walkNodes(tree, (owner) => {
      for (const b of owner.animations ?? []) {
        const key = b.targetId ?? owner.id
        if (!index.has(key)) index.set(key, [])
        index.get(key).push({ b, ownerId: owner.id })
      }
    })
  }
  return index
}

/** animation bindings inside a component root moving a given master node */
function scopedAnimTargets(root, masterId) {
  const list = []
  walkNodes([root], (owner) => {
    for (const b of owner.animations ?? []) {
      if ((b.targetId ?? owner.id) === masterId) list.push({ b, ownerId: owner.id })
    }
  })
  return list
}

/** interactions inside a component root targeting a given master node */
function scopedTargets(root, masterId) {
  const list = []
  walkNodes([root], (owner) => {
    for (const i of owner.interactions ?? []) {
      if ((i.targetId ?? owner.id) === masterId) list.push({ i, ownerId: owner.id })
    }
  })
  return list
}

// ---------- CSS ----------

function collectCandidates(project) {
  const candidates = new Set()
  // emitted by the renderer, never authored: @item link wrappers and bare
  // component roots rely on `display: contents` to stay layout-transparent
  candidates.add('contents')
  const anim = new Map((project.interactions ?? []).map((a) => [a.id, a]))
  const add = (classString) => {
    for (const token of (classString ?? '').split(/\s+/)) if (token) candidates.add(token)
  }
  const scanNode = (node) => {
    add(node.classes)
    // every option's overrides, whether or not an instance picks it today
    for (const classes of Object.values(node.variantClasses ?? {})) add(classes)
    // a slider's track/slide/chrome classes are emitted by the renderer, not
    // authored — without this they never reach the compiled stylesheet
    if (node.type === 'slider') add(sliderCandidateClasses(node.slider, project.breakpoints))
    for (const b of node.interactions ?? []) {
      const a = anim.get(b.interactionId)
      if (!a) continue
      add(a.toClasses)
      add(a.duration)
      add(a.easing)
      candidates.add('transition-all')
    }
  }
  for (const page of project.pages) walkNodes(page.elements, scanNode)
  for (const component of project.components ?? []) walkNodes([component.root], scanNode)
  add(NOTFOUND_CLASSES)
  return candidates
}

async function buildCss(candidates, settings, { forms = false } = {}) {
  // the root font-size goes on <html> in the export — that is what actually
  // rescales every rem, and it is the faithful reproduction of a design built
  // on a non-16px root
  const input =
    '@import "tailwindcss";\n' +
    CUSTOM_VARIANTS +
    '\n' +
    baseBodyCss(settings) +
    rootFontSizeCss(settings) +
    PROSE_CSS +
    // The honeypot's own rule, only for a site that has a form to protect.
    // Off-screen rather than display:none, which some bots detect and skip —
    // tripping it is exactly the signal we want. A renderer-invented class, so
    // it gets a real rule rather than a candidate.
    (forms ? HONEYPOT_CSS : '') +
    themeBlock(settings)
  const compiler = await compile(input, { base: ROOT, onDependency() {} })
  const css = compiler.build([...candidates])
  return optimize(css, { minify: true }).code
}

// ---------- HTML serialization ----------
// ctx: { project, locale, defaultLocale, scope, mm, plainTargets, fx, rewrite, itemStack }

function classFor(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  const own = ownClasses(node, mapping).split(/\s+/).filter(Boolean)
  const bindings = mapping
    ? scopedTargets(mapping.root, mapping.master.id)
    : (ctx.plainTargets.get(node.id) ?? [])
  // deduped by INTERACTION, not by binding: an open button, a close button and
  // an overlay are three bindings driving ONE effect on this node, so its
  // transition setup is emitted once (mirrors useInteraction.classesFor)
  const seen = new Set()
  const setup = []
  for (const { i } of bindings) {
    if (seen.has(i.interactionId)) continue
    seen.add(i.interactionId)
    const a = ctx.anim.get(i.interactionId)
    if (a) setup.push(`transition-all ${a.duration} ${a.easing}`)
  }
  // the interaction's transition setup replaces the element's own transition
  // classes — appending both left the cascade to pick a winner (editor parity:
  // useRenderNode filters through the same conflictingBaseClasses)
  let base = own
  if (setup.length) {
    const remove = new Set(conflictingBaseClasses(own, setup.join(' ')))
    base = own.filter((t) => !remove.has(t))
  }
  return [...base, ...setup].join(' ').trim()
}

/**
 * Final href for a linked node, or null. '@item' resolves to the current
 * entry's page; scheme-allowlisted; internal links get locale-prefixed.
 * Mirrors PublicRenderer/PreviewRenderer linkTarget — keep the three in sync.
 */
function resolveHref(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  // along the CHAIN (own → each mirror → master), mirroring useRenderNode's
  // linkRaw: `?? master.link` skipped the mirror layer, so a host's link on a
  // nested instance was stored and rendered by nobody
  let raw = resolveInstanceValue(node, mapping, 'link')
  if (raw === '@item') {
    // null for a data-only collection: there is no page to link to, so the
    // element renders unlinked rather than pointing at a route that 404s
    raw = ctx.scope?.entry ? entryRoutePath(ctx.scope.collection, ctx.scope.entry) : null
  }
  // '@locale:xx' — THIS page in another locale (the language-switcher target).
  // A plain '/…' link can't express it: internal links are auto-prefixed with
  // the CURRENT locale, so from /fr every path leads back to /fr/….
  if (raw?.startsWith('@locale:')) {
    const code = raw.slice('@locale:'.length)
    if (!ctx.project.locales.includes(code)) return null
    const path = ctx.routePath ?? '/'
    return code === ctx.defaultLocale ? path : `/${code}${path === '/' ? '' : path}`
  }
  if (!raw || !SAFE_HREF.test(raw)) return null
  // a link straight at a library asset (a PDF, a logo download) resolves to its
  // exported hashed path, exactly like an <img src> does
  const asset = ctx.rewrite(raw)
  if (asset !== raw) return asset ?? null
  let href = raw
  if (raw.startsWith('/')) {
    const first = raw.split('/')[1] ?? ''
    if (ctx.project.locales.includes(first)) {
      if (first === ctx.defaultLocale) href = raw.slice(first.length + 1) || '/'
    } else if (ctx.locale !== ctx.defaultLocale) {
      href = `/${ctx.locale}${raw === '/' ? '' : raw}`
    }
  }
  return href
}

/** locale-prefix internal `<a href>` links INSIDE rich content, mirroring
 * resolveHref's internal-link rules (strip an explicit default-locale prefix,
 * prefix the current non-default locale) — @link targets were prefixed while
 * rich-text anchors shipped default-locale paths that trapped visitors out of
 * their locale. Exported asset paths are left untouched. Runs AFTER
 * rewriteRichMedia so media refs are already /assets/… and skipped. */
function localizeRichHrefs(html, ctx) {
  return html.replace(/(<a\b[^>]*\shref=")([^"]*)(")/gi, (m, pre, href, post) => {
    if (!href.startsWith('/') || href.startsWith('/assets/')) return m
    const first = href.split('/')[1] ?? ''
    let out = href
    if (ctx.project.locales.includes(first)) {
      if (first === ctx.defaultLocale) out = href.slice(first.length + 1) || '/'
    } else if (ctx.locale !== ctx.defaultLocale) {
      out = `/${ctx.locale}${href === '/' ? '' : href}`
    }
    return pre + out + post
  })
}

/** wraps a non-anchor linked element in an <a> so it navigates without JS;
 * display:contents keeps the wrapper out of the layout */
/** the path this route renders at, locale-prefixed like resolveHref's output —
 * so `href === currentPath` identifies the link that points at this very page */
function currentPathFor(ctx) {
  const path = ctx.routePath ?? '/'
  if (ctx.locale === ctx.defaultLocale) return path
  return `/${ctx.locale}${path === '/' ? '' : path}`
}

/** aria-current="page" for a link that points at the page being rendered.
 * This is what makes "style the active nav item" possible AT ALL inside a
 * shared component: the master has no idea which page an instance is on, so
 * the state has to come from the rendered route, not from the document. */
function ariaCurrentFor(href, ctx) {
  return href === currentPathFor(ctx) ? ' aria-current="page"' : ''
}

function linkWrap(html, node, ctx) {
  if (ELEMENTS[node.type]?.tag === 'a') return html
  // a slider carries its own buttons — wrapping it in an anchor is invalid
  // HTML (interactive content inside <a>) and would make every arrow click
  // navigate instead of paging. The Data panel hides the Link field for a
  // slider; this covers the code's '@target' suffix and the MCP.
  if (node.type === 'slider') return html
  const href = resolveHref(node, ctx)
  if (!href) return html
  // link-related attributes belong on the ANCHOR, not on the element inside it:
  // target="_blank" on a <div> never opens a new tab, and aria-label on a
  // non-interactive div is not announced as the link's name. attrsFor holds
  // these back for exactly this reason.
  const mapping = ctx.mm.get(node.id)
  const custom = withSafeRel(
    sanitizeAttributes(nodeAttributes(node, mapping, ctx.locale, ctx.defaultLocale)),
  )
  const { link } = splitLinkAttributes(custom)
  const extra = Object.entries(link)
    .map(([name, value]) => ' ' + serializeAttribute(name, value, escapeHtml))
    .join('')
  const current = 'aria-current' in link ? '' : ariaCurrentFor(href, ctx)
  return `<a href="${escapeHtml(href)}" class="contents"${extra}${current}>${html}</a>`
}

/** `wrapLink: false` for a node rendered without a linkWrap (the <body> tag),
 * so its link attributes are not held back for an anchor that never appears.
 * `extraClass` is renderer-owned chrome (a slider's positioning context) that
 * belongs on the host but isn't part of the node's authored classes. */
function attrsFor(node, ctx, bg, { wrapLink = true, extraClass = '' } = {}) {
  const mapping = ctx.mm.get(node.id)
  const def = ELEMENTS[node.type]
  const attrs = []
  if (node.htmlId) attrs.push(`id="${escapeHtml(node.htmlId)}"`)

  const classes = [classFor(node, ctx), bg?.hostClass, extraClass].filter(Boolean).join(' ')
  if (classes) attrs.push(`class="${escapeHtml(classes)}"`)
  // NOTE: the style attribute is emitted at the END of this function, so a
  // background style and an animation's first frame merge instead of clashing

  // src: bound image field (possibly through a reference hop), else the
  // node's own, else — inside a component instance — the mapped master's.
  // Same own-then-master precedence as content: shared chrome (a logo) is set
  // ONCE on the master and every instance without its own src renders it.
  const binding = ctx.scope
    ? resolveBinding(ctx.project.collections, ctx.scope.collection, ctx.scope.entry, node.arg)
    : null
  let src = undefined
  if (!src && binding?.field.type === 'image' && binding.entry) {
    src = entryValue(binding.entry, binding.field, ctx.locale, ctx.defaultLocale)
  }
  // a multi-image field bound straight to one :image (outside a
  // :collection-list) renders its FIRST url — the cover-image case
  if (!src && binding?.field.type === 'multi-image' && binding.entry) {
    src = mediaUrls(binding.entry, binding.field.name)[0]
  }
  src ||= nodeSrc(node, ctx.locale, ctx.defaultLocale)
  for (const source of mapping ? [...mapping.mirrors, mapping.master] : []) {
    src ||= nodeSrc(source, ctx.locale, ctx.defaultLocale)
  }
  const rawSrc = src // pre-rewrite value — library alt lookup keys on it
  src = ctx.rewrite(src)
  // only media tags carry src — a :collection-list[gallery] div resolved the
  // multi-image binding too and shipped a meaningless src attribute
  const mediaTag = def?.tag === 'img' || def?.tag === 'video'
  if (mediaTag && src && SAFE_SRC.test(src)) attrs.push(`src="${escapeHtml(src)}"`)
  // custom attributes are master-aware like classes; sanitized once, used for
  // both the alt precedence below and the pass-through loop at the end
  const custom = withSafeRel(
    sanitizeAttributes(nodeAttributes(node, mapping, ctx.locale, ctx.defaultLocale)),
  )
  // attribute values bound to collection fields, resolved in the entry scope
  // being rendered (mirrors useRenderNode's customAttrs). Per-instance with a
  // component default, like listQuery.
  //
  // Resolved HERE, before `alt`/`href` are emitted, and not after: those names
  // are in `managed` below, so the pass-through loop skips them. Bound last,
  // a `data-bind-alt` could never reach the page while the canvas and Play
  // rendered it correctly — the whole point of the binding is the per-entry
  // alt text a <img data-field> cannot otherwise have.
  const boundAttrs = resolveInstanceValue(node, mapping, 'fieldAttrs')
  const withBound =
    boundAttrs && ctx.scope?.entry
      ? resolveFieldAttrs(
          boundAttrs,
          ctx.scope.collection,
          (field) => entryValue(ctx.scope.entry, field, ctx.locale, ctx.defaultLocale) ?? '',
          custom,
        )
      : custom
  // images always carry alt: the bound field, else the author's attributes.alt,
  // else the library asset's default, else '' (decorative)
  if (def?.tag === 'img') {
    attrs.push(`alt="${escapeHtml(withBound.alt ?? ctx.altFor?.(rawSrc) ?? '')}"`)
    // Performance hints, EXPORTER-ONLY and deliberately so: they change no
    // pixel, and the canvas loads every image eagerly anyway, so mirroring
    // them into useRenderNode would be noise. This is the one documented
    // exception to the three-renderers rule.
    //
    // width/height are the intrinsic pixel size, which reserves the box and
    // stops the page reflowing as images arrive. Neither name is in
    // ATTR_ALLOW, so an author can never have set one — no conflict to
    // resolve. They never distort: the exported stylesheet's preflight
    // carries `img,video{max-width:100%;height:auto}`.
    const size = ctx.sizeFor?.(rawSrc)
    if (size) attrs.push(`width="${size.width}" height="${size.height}"`)
    // Resized copies the browser may take instead of the full file. `src`
    // stays the ORIGINAL, so a browser without srcset — and any image whose
    // widths were all larger than it — still gets a working picture.
    //
    // `sizes` says how wide the image will RENDER, which is the one thing the
    // export cannot know: an author who puts three cards in a row sets
    // `sizes="(min-width: 768px) 33vw, 100vw"` and the browser picks a third
    // of the file. 100vw is the honest default — it over-fetches rather than
    // shipping a blurry image.
    const srcset = ctx.srcsetFor?.(rawSrc)
    if (srcset) {
      attrs.push(`srcset="${escapeHtml(srcset)}"`)
      attrs.push(`sizes="${escapeHtml(withBound.sizes ?? '100vw')}"`)
    }
    attrs.push('decoding="async"')
    // One image eager per route, not three: a hero is one image, and
    // fetchpriority="high" on several is worse than on none. An authored
    // `loading` wins — it IS allowlisted, and emitting ours too would
    // duplicate the attribute (the FIRST occurrence is what a browser reads).
    if (!('loading' in withBound)) {
      if (ctx.imgCount.n === 0) attrs.push('fetchpriority="high"')
      else attrs.push('loading="lazy"')
    }
    ctx.imgCount.n += 1
  }

  // href: link elements only, scheme-allowlisted, locale-prefixed internals.
  // href on <a> elements; non-anchor linked elements are wrapped instead
  // (see renderNode). Locale-explicit links are absolute; default-locale
  // prefix normalizes away (locale-switcher authoring).
  if (def?.tag === 'a') {
    const href = resolveHref(node, ctx)
    if (href) {
      attrs.push(`href="${escapeHtml(href)}"`)
      if (!custom['aria-current']) {
        const current = ariaCurrentFor(href, ctx)
        if (current) attrs.push(current.trim())
      }
    }
  }

  // interaction wiring for the runtime
  // The scope that makes a binding key unique: the component instance AND the
  // collection-list repeat. Without the entry part, every repeated card shares
  // one key — hovering one lights them all, and "appear once" fires once for
  // the whole list instead of once per card.
  // The ENTRY part of a binding's scope follows the TARGET, not the trigger: it
  // is carried only when the owner and the target sit in the same entry scope
  // (both inside one repeat, or both outside every repeat). A row button that
  // opens ONE shared sheet outside the list therefore keys the effect exactly
  // the way the sheet — rendered once, with no entry of its own — keys it.
  // Keyed off the trigger (as this used to be), the button wrote `X@e<row>`
  // while the sheet listened on `X`, so every such click did nothing.
  //
  // A CHANNEL target is the one exception, and it is unconditional: no
  // instance part, no entry part, for a page owner and a master owner alike.
  // A channel is site-wide by definition — the trigger and the listener are in
  // different trees, so any scope either side added would be a scope the other
  // could not reproduce.
  const scopeFor = (ownerId, targetId) =>
    isChannelTarget(targetId)
      ? undefined
      : bindingScope(
          mapping ? mapping.instanceId : null,
          entryScopePart(ctx.scopeRoots, ownerId, targetId, ctx.scope?.entry?.id),
        )
  const scopedKey = (id, ownerId, targetId) => {
    const scope = scopeFor(ownerId, targetId)
    return scope ? `${id}@${scope}` : id
  }
  // exclusive groups key on the component instance ONLY, never the repeat: "one
  // accordion open at a time" has to hold across a collection-list's items
  const instanceScope = mapping ? mapping.instanceId : undefined
  // the element a binding's effect lands on (its own node unless retargeted);
  // inside a component instance, "itself" means the MASTER node
  const selfId = mapping ? mapping.master.id : node.id
  /** the key the EFFECT's on/off state lives under — one per (interaction,
   * target), so every trigger pointing at it shares one boolean. `ownerId` is
   * the node the binding is DECLARED on, which the entry scope reads. */
  const stateKeyFor = (i, ownerId) => {
    const targetId = i.targetId ?? ownerId
    return interactionStateKey(i.interactionId, targetId, scopeFor(ownerId, targetId))
  }

  const triggers = (mapping ? mapping.master.interactions : node.interactions) ?? []
  if (triggers.length) {
    const list = triggers.map((i) => {
      const key = scopedKey(i.id, selfId, i.targetId ?? selfId)
      const state = stateKeyFor(i, selfId)
      ctx.fx[state] = ctx.anim.get(i.interactionId)?.toClasses ?? ''
      const meta = { t: i.trigger, k: key, s: state }
      if (i.action && i.action !== 'toggle') meta.a = i.action
      if (i.closeOn?.length) meta.c = i.closeOn
      // a group on a channel-targeting binding is UNSCOPED too, so one group
      // can span a page trigger and a master trigger — which is what makes the
      // "opening resets to step 1" recipe work across the component boundary
      if (i.group) {
        meta.g = interactionGroupKey(
          i.group,
          isChannelTarget(i.targetId) ? undefined : instanceScope,
        )
      }
      if (i.once) meta.o = i.once
      if (i.trigger === 'scrolled') meta.at = i.scrollAt ?? DEFAULT_SCROLL_AT
      return meta
    })
    attrs.push(`data-int="${escapeHtml(JSON.stringify(list))}"`)
  }
  // --- channels: the listener side ---
  // The element DECLARES a channel and every binding in the project aimed at
  // that name lands on it — from another component, from another page's tree,
  // from a master this route renders once. The index is project-wide and built
  // once (ctx.channels), never "what has rendered so far": a header component
  // on route B is not in route A's walk, and the listener still has to carry
  // the key and fill ctx.fx for it.
  //
  // The channel is SHARED state, like classes: inside an instance it is the
  // master's, so a mirror cannot override it.
  const declaredChannel = (mapping ? mapping.master : node).channel
  const channel = isChannelName(declaredChannel) ? declaredChannel : null
  const channelDrivers = channel ? ctx.channels?.get(channel) : null
  const channelTarget = channel ? `@${channel}` : null

  const targets = mapping
    ? scopedTargets(mapping.root, mapping.master.id)
    : (ctx.plainTargets.get(node.id) ?? [])
  // every binding landing here, paired with the key it drives — a plain target
  // keys by its own scope, a channel binding by nothing at all
  const driven = targets.map(({ i, ownerId }) => ({ i, key: stateKeyFor(i, ownerId) }))
  for (const { binding } of channelDrivers?.interactions ?? []) {
    driven.push({ i: binding, key: interactionStateKey(binding.interactionId, channelTarget) })
  }
  if (driven.length) {
    // several bindings can drive one effect on this node — dedupe to the
    // distinct state keys, or its to-classes would be applied once per binding
    // self bindings (no targetId) resolve to the MASTER node inside a component
    // instance — the trigger side keys the effect under selfId, so the target
    // side must too, or the runtime looks up an empty entry under the instance id
    const targetKeys = [...new Set(driven.map(({ key }) => key))]
    const baseTokens = classes.split(/\s+/).filter(Boolean)
    for (const { i, key } of driven) {
      const to = ctx.anim.get(i.interactionId)?.toClasses ?? ''
      ctx.fx[key] ??= ''
      // Breakpoint gating moved from the binding key to the STATE key, because
      // that is what the target's class list is now keyed by. An effect is gated
      // to the UNION of its bindings' breakpoints, and a single unscoped binding
      // makes it unscoped — anything else would let a mobile-only close button
      // silently suppress a desktop open button's classes.
      if (i.breakpoints) {
        if (!ctx.fxbpAll.has(key)) {
          ctx.fxbp[key] = [...new Set([...(ctx.fxbp[key] ?? []), ...i.breakpoints])]
        }
      } else {
        ctx.fxbpAll.add(key)
        delete ctx.fxbp[key]
      }
      // base classes styling the same property as the fired classes are
      // REMOVED while fired (int-fxrm) — the cascade would otherwise pick an
      // arbitrary winner (hidden beats flex, so menu toggles never opened)
      const rm = conflictingBaseClasses(baseTokens, to)
      if (rm.length) ctx.fxrm[key] = rm.join(' ')
      // the modal flag belongs to the EFFECT, like closeOn and the group, so
      // it is recorded per state key whichever binding declares it
      if (ctx.anim.get(i.interactionId)?.modal) ctx.fxModal[key] = 1
    }
    attrs.push(`data-tgt="${escapeHtml(targetKeys.join(' '))}"`)
  }

  // --- animations: same trigger/target split, tween engine instead of classes ---
  const animTriggers = (mapping ? mapping.master.animations : node.animations) ?? []
  if (animTriggers.length) {
    const list = []
    for (const b of animTriggers) {
      const animation = ctx.animLib.get(b.animationId)
      if (!animation) continue // library entry deleted — skip rather than emit a dangling key
      const key = scopedKey(b.id, selfId, b.targetId ?? selfId)
      ctx.animUsed[b.animationId] = animation
      if (b.breakpoints) ctx.animBp[key] = b.breakpoints
      const meta = { k: key, t: b.trigger, a: b.animationId }
      // A CLICK play is shared per (animation, target), so an open button, a
      // close button and an overlay drive ONE timeline — the same model the
      // class engine's state key gives `data-int`. `k` stays the per-binding
      // key (it is what `data-atgt` and the breakpoint gate are keyed by);
      // `s` is only the play key, and only a click emits one (see
      // animationStateKey for why hover is excluded).
      if (b.trigger === 'click') {
        const animTargetId = b.targetId ?? selfId
        meta.s = animationStateKey(b.animationId, animTargetId, scopeFor(selfId, animTargetId))
        if (b.action && b.action !== 'toggle') meta.ac = b.action
      }
      // the site default resolves HERE, not in the browser: the runtime reads an
      // absent `m` as "play once", which is exactly what an effective 'once'
      // means — so inheritance costs the wire format nothing.
      const mode =
        b.trigger === 'appear' ? effectiveAppearMode(b.appearMode, ctx.appearDefault) : undefined
      const carriesMode = mode === 'replay' || mode === 'reverse'
      // only carry options the runtime actually needs, so the payload stays small
      if (carriesMode || b.scrub || b.appearAt) {
        meta.o = {}
        if (carriesMode) meta.o.m = mode
        if (b.appearAt) meta.o.at = b.appearAt
        if (b.scrub) meta.o.s = b.scrub
      }
      // the scroll threshold rides beside the options rather than inside them:
      // `o` is read for appear/scrub, and a flat key keeps the hot path simple
      if (b.trigger === 'scrolled' && b.scrollAt !== undefined) meta.at2 = b.scrollAt
      // ms the forward play waits after the trigger — omitted when 0, so an
      // undelayed binding costs the wire nothing
      const delay = bindingDelay(b)
      if (delay) meta.d = delay
      list.push(meta)
    }
    if (list.length) attrs.push(`data-anim="${escapeHtml(JSON.stringify(list))}"`)
  }
  const animTargets = mapping
    ? scopedAnimTargets(mapping.root, mapping.master.id)
    : (ctx.plainAnimTargets.get(node.id) ?? [])
  // `data-atgt` is matched by the BINDING key (`meta.k`), not the play key, so
  // a channel binding's `k` is unscoped on both sides — which is exactly what
  // `scopeFor` returns for it. Click only (the one shared tween key), so there
  // is never a first frame to bake here.
  const animDriven = animTargets.map(({ b, ownerId }) => ({
    b,
    key: scopedKey(b.id, ownerId, b.targetId ?? ownerId),
    bake: true,
  }))
  for (const { binding } of channelDrivers?.animations ?? []) {
    if (binding.trigger !== 'click') continue
    animDriven.push({ b: binding, key: binding.id, bake: false })
  }
  const firstFrame = {}
  if (animDriven.length) {
    const keys = []
    const toPrime = []
    for (const { b, key, bake } of animDriven) {
      const animation = ctx.animLib.get(b.animationId)
      if (!animation) continue
      ctx.animUsed[b.animationId] = animation
      if (b.breakpoints) ctx.animBp[key] = b.breakpoints
      keys.push(key)
      // the pre-play state, baked in so an entrance never paints its final
      // frame before the deferred runtime boots (hover/click/scrub start from
      // the natural state, so they are not primed). Breakpoint-SCOPED
      // entrances are never baked: the inline style has no breakpoint gate, so
      // it applied at every width while the runtime only ever animated (or
      // end-stated) it inside the scope — outside it the element sat invisible
      // forever. Scoped entrances are primed by the runtime instead (a brief
      // natural-state paint inside the scope is the accepted tradeoff, same as
      // staggered children).
      if (bake && (b.trigger === 'load' || b.trigger === 'appear') && !b.breakpoints) {
        toPrime.push({ compiled: splitByStagger(compileAnimation(animation)).element, delay: bindingDelay(b) })
      }
    }
    // ONE rule for several entrances on one node — per property, the `from` of
    // the timeline that starts earliest (binding delay + track offset). Merged
    // in binding order with the last one winning, an "open" (0 → 1 at t=0)
    // followed by a "close" (1 → 0, seconds later) primed the element VISIBLE,
    // with both states painted at once. The runtime primes with the same
    // helper, so the two cannot disagree.
    if (toPrime.length) Object.assign(firstFrame, primeFirstFrame(toPrime))
    if (keys.length) attrs.push(`data-atgt="${escapeHtml(keys.join(' '))}"`)
  }

  // one style attribute: the background's inline style plus the pre-play
  // first frame of any load/appear animation on this node
  const styleText = [bg?.style, cssDecls(firstFrame)].filter(Boolean).join(';')
  if (styleText) attrs.push(`style="${escapeHtml(styleText)}"`)

  // custom attributes (allowlisted) — never override an attribute the
  // renderer already manages (alt was consumed above, where the author's
  // value takes precedence over the library default). On a non-anchor element
  // that linkWrap will wrap, the link-related half hoists onto the generated
  // <a> and is skipped here.
  // `sizes` is consumed above, beside the srcset it describes — emitted there
  // or not at all, since it means nothing without one
  // `managed` names are written by this function itself (or resolved before it),
  // so the pass-through loop must not emit them a second time. The slider's
  // label attributes are in here because they are CONSUMED, not rendered: they
  // set the chrome's aria-labels, which are emitted on the arrows and the dot
  // rail, not on the host.
  const managed = new Set([
    'id',
    'class',
    'style',
    'src',
    'alt',
    'href',
    'sizes',
    ...Object.keys(SLIDER_LABEL_ATTRS),
  ])
  const wrapsInAnchor = wrapLink && def?.tag !== 'a' && !!resolveHref(node, ctx)
  const own = wrapsInAnchor ? splitLinkAttributes(withBound).element : withBound
  // attributes the element TYPE implies (:checkbox → type="checkbox"), unless
  // the author set that attribute themselves
  const implied = def?.attrs ?? {}
  for (const [name, value] of Object.entries(implied)) {
    if (managed.has(name) || name in own) continue
    attrs.push(serializeAttribute(name, value, escapeHtml))
  }
  for (const [name, value] of Object.entries(own)) {
    if (managed.has(name)) continue
    attrs.push(serializeAttribute(name, value, escapeHtml))
  }

  return attrs.length ? ' ' + attrs.join(' ') : ''
}

function renderNode(node, ctx) {
  // a hidden node emits nothing — own flag first, then its component's
  if (node.type !== 'body' && isNodeHidden(node, ctx.mm.get(node.id))) return ''

  const def = ELEMENTS[node.type]
  const tag = def?.tag ?? 'div'

  // a component instance's :Name wrapper is a logical grouping, not a visual
  // box — with nothing of its own to say it emits NO element (its children
  // render inline), so `header → component` stays a bare <header>, not
  // <div><header>. A styled/interactive/targeted wrapper stays real.
  //
  // The predicate is shared (isBareWrapper) because this return happens BEFORE
  // attrsFor: everything that call would have emitted for the wrapper —
  // data-tgt, data-anim, its ctx.fx and int-modal registration — is discarded
  // silently. A channel on a master ROOT published a modal nothing could open,
  // and adding one class to the root made it work again.
  if (/^[A-Z]/.test(node.type)) {
    const mapping = ctx.mm.get(node.id)
    const master = mapping?.master ?? node
    const targeted = mapping
      ? scopedTargets(mapping.root, mapping.master.id).length > 0 ||
        scopedAnimTargets(mapping.root, mapping.master.id).length > 0
      : (ctx.plainTargets.get(node.id) ?? []).length > 0
    const bare = isBareWrapper(node, master, {
      classes: ownClasses(node, mapping),
      targeted,
    })
    if (bare) return node.children.map((child) => renderNode(child, ctx)).join('')
  }

  if (node.type === 'collection-list') {
    // the arg names a collection (all entries) or a multi-reference field
    // of the surrounding scope entry (mirrors useRenderNode.listScope)
    const list = resolveListScope(
      ctx.project.collections,
      ctx.scope?.collection ?? null,
      ctx.scope?.entry ?? null,
      node.arg,
      ctx.project.pages,
    )
    // filter → sort → limit from the node's listQuery (node-only state).
    // For the @pages source the synthetic entry ids ARE page ids, so
    // excludeCurrent means "every page except this one" for free.
    const currentEntryId =
      list?.collection.id === '@pages' ? ctx.pageId : ctx.scope?.entry?.id
    // per-instance with a component default, resolved along the chain like
    // content (mirrors useRenderNode) — a list extracted into a component keeps
    // the filter that moved to its master
    const listQuery = resolveInstanceValue(node, ctx.mm.get(node.id), 'listQuery')
    const listEntries = list ? applyListQuery(list.entries, listQuery, { currentEntryId }) : []
    // the row TEMPLATE is the children minus any empty-state block, which is
    // never repeated and renders only when there is nothing to repeat
    const template = node.children.filter((c) => c.type !== 'list-empty')
    const emptyState = node.children.filter((c) => c.type === 'list-empty')
    const inner = !list
      ? ''
      : listEntries.length
        ? listEntries
            .map((entry, index) => {
              const inner2 = {
                ...ctx,
                scope: { collection: list.collection, entry, index, count: listEntries.length },
              }
              return template.map((child) => renderNode(child, inner2)).join('')
            })
            .join('')
        : emptyState.map((child) => renderNode(child, ctx)).join('')
    return linkWrap(`<${tag}${attrsFor(node, ctx)}>${inner}</${tag}>`, node, ctx)
  }

  // carousel — the same DOM the editor renders (useRenderNode + the two Vue
  // renderers), driven on the published site by /assets/slider.js. With an arg
  // it repeats per entry like a :collection-list, one slide each; without one,
  // each direct child is a slide.
  if (node.type === 'slider') {
    // the instance's own config, else its component's (see listQuery above)
    const sliderConfig = resolveInstanceValue(node, ctx.mm.get(node.id), 'slider')
    const config = resolveSliderConfig(sliderConfig, ctx.project.breakpoints)
    const list = node.arg
      ? resolveListScope(
          ctx.project.collections,
          ctx.scope?.collection ?? null,
          ctx.scope?.entry ?? null,
          node.arg,
          ctx.project.pages,
        )
      : null
    const slide = (html) => `<div data-sl-slide class="${escapeHtml(SLIDER_SLIDE_CLASSES)}">${html}</div>`
    let slides = ''
    if (list) {
      const currentEntryId = list.collection.id === '@pages' ? ctx.pageId : ctx.scope?.entry?.id
      const entries = applyListQuery(
        list.entries,
        resolveInstanceValue(node, ctx.mm.get(node.id), 'listQuery'),
        { currentEntryId },
      )
      const template = node.children.filter((c) => c.type !== 'list-empty')
      slides = entries
        .map((entry, index) => {
          const inner = {
            ...ctx,
            scope: { collection: list.collection, entry, index, count: entries.length },
          }
          return slide(template.map((child) => renderNode(child, inner)).join(''))
        })
        .join('')
      // a bound slider with nothing to show renders its empty state as one slide
      if (!entries.length) {
        const emptyState = node.children.filter((c) => c.type === 'list-empty')
        slides = emptyState.length
          ? slide(emptyState.map((child) => renderNode(child, ctx)).join(''))
          : ''
      }
    } else if (!node.arg) {
      slides = node.children.map((child) => slide(renderNode(child, ctx))).join('')
    }
    const track = `<div data-sl-track class="${escapeHtml(sliderTrackClasses(sliderConfig, ctx.project.breakpoints))}">${slides}</div>`
    // the chrome's WORDS, per locale: the authored label attributes over the
    // built-in defaults. They used to be English literals here, so every
    // /fr/ route shipped "Previous slide" and the worklist never offered them.
    const labels = resolveSliderLabels(
      nodeAttributes(node, ctx.mm.get(node.id), ctx.locale, ctx.defaultLocale),
    )
    const arrow = (side, cls, svg, label) =>
      `<button type="button" data-sl-${side} aria-label="${escapeHtml(label)}" class="${escapeHtml(`${SLIDER_ARROW_CLASSES} ${cls}`)}">${svg}</button>`
    const arrows = config.arrows
      ? arrow('prev', SLIDER_PREV_CLASS, SLIDER_PREV_SVG, labels.prev) +
        arrow('next', SLIDER_NEXT_CLASS, SLIDER_NEXT_SVG, labels.next)
      : ''
    // the runtime fills the dot rail — it alone knows the reachable count, so
    // the per-dot pattern travels on the wire (data.dl)
    const dots = config.dots
      ? `<div data-sl-dots role="tablist" aria-label="${escapeHtml(labels.dots)}" class="${escapeHtml(SLIDER_DOTS_CLASSES)}"></div>`
      : ''
    const wire = JSON.stringify(sliderWireData(sliderConfig, labels)).replaceAll('</', '<\\/')
    ctx.sliderIds.add(node.id)
    const attrs = attrsFor(node, ctx, undefined, {
      extraClass: sliderHostExtraClass(node.classes),
    })
    return linkWrap(
      `<${tag}${attrs} data-slider="${escapeHtml(wire)}">${track}${arrows}${dots}</${tag}>`,
      node,
      ctx,
    )
  }

  // a form. With `enabled` it posts to this instance's public endpoint and
  // carries the runtime's own hidden fields; without it, it is the plain form
  // it always was (or, with an externalAction, posts to a third party).
  if (node.type === 'form') {
    const config = resolveInstanceValue(node, ctx.mm.get(node.id), 'form')
    const enabled = formEnabled(config)
    // the fields render inline; the state blocks are emitted hidden and shown
    // by the runtime (or by the ?form=sent landing for a visitor without JS)
    const template = node.children.filter((c) => !FORM_STATE_TYPES.includes(c.type))
    const states = node.children.filter((c) => FORM_STATE_TYPES.includes(c.type))
    const fieldsHtml = template.map((child) => renderNode(child, ctx)).join('')
    const statesHtml = states
      .map((child) => {
        const mark = child.type === 'form-success' ? 'data-form-success' : 'data-form-error'
        // hidden by the attribute, not a class: a class could be overridden by
        // the author's own styling and the block would show on first paint
        return `<div ${mark} hidden>${renderNode(child, ctx)}</div>`
      })
      .join('')

    let extra = ''
    let formAttrs = ''
    if (enabled) {
      // `action`/`method` are NOT in the attribute allowlist, so the exporter
      // owns them outright — an author cannot repoint a form at another host.
      const action = `${ctx.apiOrigin}/_guano/forms/${encodeURIComponent(node.id)}`
      formAttrs = ` method="post" action="${escapeHtml(action)}" data-form="${escapeHtml(node.id)}" accept-charset="utf-8"`
      // the runtime navigates here on success. Re-validated at export: a blob
      // can arrive by import, merge or agent without passing any writer, and
      // an open redirect on someone else's site is not ours to ship.
      if (config.redirect && isInternalRoute(config.redirect)) {
        formAttrs += ` data-form-redirect="${escapeHtml(config.redirect)}"`
      }
      // the honeypot and the elapsed-time field do the spam work a constant
      // embedded token never could (a static page can only carry a constant,
      // which a scraper copies). `_route` is checked against the manifest.
      extra =
        `<input type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true" class="${HONEYPOT_CLASS}">` +
        `<input type="hidden" name="_route" value="${escapeHtml(ctx.routePath ? `/${String(ctx.routePath).replace(/^\/+/, '')}` : '/')}">`
      if (ctx.scope?.entry?.id) {
        extra += `<input type="hidden" name="_entry" value="${escapeHtml(ctx.scope.entry.id)}">`
      }
      ctx.forms.set(node.id, { node, config, mm: ctx.mm, scope: ctx.scope ?? null })
    } else if (config?.externalAction && isExternalPostUrl(config.externalAction)) {
      // The escape hatch: a third-party endpoint. Nothing is stored here, and
      // the publish warns that submissions leave the instance.
      //
      // Re-validated HERE as well as at write, for the same reason the redirect
      // is: a blob can arrive by import, by a 3-way merge or from an agent
      // without passing any writer, and an unchecked `action` is a `javascript:`
      // URL away from script on the published origin.
      formAttrs = ` method="post" action="${escapeHtml(config.externalAction)}"`
    } else {
      // A form that is neither enabled nor pointed at a third party sends
      // NOWHERE — and nowhere has to be made true, not merely left unwired.
      // A bare <form> still submits natively: Enter in a text field, or any
      // <button> without a type, makes the browser GET the CURRENT url with
      // every named control in the query string. On the questionnaire this was
      // written for, that is the answers in the address bar, in history and in
      // the host's access logs, which for a health intake is the one outcome
      // nobody asked for. The handbook called this shape safe.
      //
      // `method="dialog"` is the fix that needs no script: per the HTML
      // standard, submitting a dialog-method form with no <dialog> ancestor
      // abandons the submission — after constraint validation, so the browser
      // still shows "please fill in this field". `data-form-inert` is the
      // runtime's own mark (a reserved name, so an author cannot set it), and
      // it is deliberately NOT a reason to ship the runtime: the attribute
      // pair above already holds on its own.
      formAttrs = ' method="dialog" data-form-inert'
    }
    const attrs = attrsFor(node, ctx)
    // formAttrs FIRST: a duplicate attribute resolves to the first occurrence,
    // so emitting the author's `attrs` ahead of ours let an authored
    // `data-form-redirect` shadow the validated one. The names are reserved now
    // (shared/attributes.js), and this ordering means a future gap there cannot
    // become a hijacked redirect.
    return linkWrap(
      `<${tag}${formAttrs}${attrs}>${fieldsHtml}${extra}${statesHtml}</${tag}>`,
      node,
      ctx,
    )
  }

  if (node.type === 'collection-item') {
    const collection = node.arg
      ? ctx.project.collections.find((c) => c.name === node.arg)
      : null
    const entryId = resolveInstanceValue(node, ctx.mm.get(node.id), 'entryId')
    const entry = collection?.entries.find((e) => e.id === entryId) ?? null
    const selfNested = !!ctx.scope && !!collection && ctx.scope.collection.id === collection.id
    let inner = ''
    if (collection && entry && !selfNested) {
      const template = ctx.project.pages.find((p) => p.id === collection.templatePageId)
      const body = template?.elements.find((b) => b.type === 'body')
      if (body) {
        const inner2 = {
          ...ctx,
          scope: { collection, entry },
          mm: buildMasterMap(body.children, ctx.project.components),
        }
        inner = body.children.map((child) => renderNode(child, inner2)).join('')
      }
    }
    return linkWrap(`<${tag}${attrsFor(node, ctx)}>${inner}</${tag}>`, node, ctx)
  }

  // an icon: the <svg> IS the element, so the node's own attributes (class,
  // id, the interaction wiring) sit on the root beside the markup's. Sanitized
  // HERE, whatever was stored: this is the line where markup becomes a page.
  if (node.type === 'icon') {
    const mapping = ctx.mm.get(node.id)
    const stored = [node, ...(mapping ? [...mapping.mirrors, mapping.master] : [])].find(
      (source) => source.svg,
    )?.svg
    const icon = parseInlineSvg((stored && sanitizeInlineSvg(stored)) || DEFAULT_ICON_SVG)
    const own = attrsFor(node, ctx)
    // the author's attributes win over the markup's (an aria-label over the
    // icon's default aria-hidden); a duplicate attribute would be dropped by
    // the parser anyway, first one kept
    const root = Object.entries(icon.attrs)
      .filter(([name]) => !new RegExp(`\\s${name}=`).test(own))
      .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
      .join('')
    return linkWrap(`<svg${own}${root}>${icon.inner}</svg>`, node, ctx)
  }

  if (def?.void) return linkWrap(`<${tag}${attrsFor(node, ctx)}>`, node, ctx)

  // background media: image → CSS bg on the host, video → a layer behind content
  const bg = backgroundFor(node, ctx)
  const bgLayer =
    bg?.kind === 'video'
      ? `<video src="${escapeHtml(bg.url)}" autoplay muted loop playsinline class="${escapeHtml(bg.layerClass)}"></video>`
      : ''

  let inner
  if (node.children.length) {
    inner = node.children.map((child) => renderNode(child, ctx)).join('')
  } else {
    const mapping = ctx.mm.get(node.id)
    // binding may hop one reference ('author.name') — mirrors useRenderNode
    const binding = ctx.scope
      ? resolveBinding(ctx.project.collections, ctx.scope.collection, ctx.scope.entry, node.arg)
      : null
    let text
    if (binding) {
      const { field, entry } = binding
      // bound fields with no entry/value render empty on the public site;
      // a directly-bound reference reads as the referenced entry name(s)
      if (field.type === 'reference' || field.type === 'multi-reference') {
        text = entry ? refDisplay(ctx.project.collections, field, entry) : ''
      } else {
        text = entry ? (entryValue(entry, field, ctx.locale, ctx.defaultLocale) ?? '') : ''
      }
    } else {
      text =
        nodeContent(node, ctx.locale, ctx.defaultLocale) ||
        (mapping ? [...mapping.mirrors, mapping.master] : [])
          .map((source) => nodeContent(source, ctx.locale, ctx.defaultLocale))
          .find(Boolean) ||
        def?.defaultContent ||
        ''
    }
    // rich text emits its sanitized subset; anything else is fully escaped
    // rich copy can link/embed library assets — rewrite those refs to the
    // exported hashed paths, or the page ships `/media/<id>` URLs that only this
    // server answers (the export is meant to deploy anywhere)
    // a custom-code block IS raw HTML, verbatim: the one leaf no sanitizer
    // touches. Writing one is gated (agent-policy.mjs codeSurface), so what
    // reaches here was put there by a build role or an allowed agent.
    inner =
      node.type === 'custom-code'
        ? text
        : isRich(text)
          ? localizeRichHrefs(rewriteRichMedia(sanitizeRich(text), ctx.rewrite), ctx)
          : escapeHtml(decodeEntities(text))
  }
  return linkWrap(`<${tag}${attrsFor(node, ctx, bg)}>${bgLayer}${inner}</${tag}>`, node, ctx)
}

/** background-media descriptor for a node (mirrors useRenderNode.backgroundInfo) */
function backgroundFor(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  const styleNode = mapping ? mapping.master : node
  const ref = styleNode.background
  if (!ref) return null
  const url = ctx.rewrite(ref)
  if (!SAFE_SRC.test(url)) return null
  // library assets resolve kind from their mime; external/data URLs infer it
  const kind = ctx.kindFor(ref) ?? backgroundKindFromUrl(url)
  const tokens = (styleNode.classes ?? '').split(/\s+/).filter(Boolean)
  return backgroundRender(kind, url, tokens)
}

/** a motion-engine style object (camelCase keys) as CSS declarations */
function cssDecls(style) {
  return Object.entries(style)
    .map(([prop, value]) => `${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(';')
}

/**
 * The no-flash guard for a page-enter transition.
 *
 * The incoming page must not paint its natural state before the deferred
 * /assets/motion.js can write the animation's first frame. Baking that frame
 * into `<body style>` — the way element entrances are primed — would leave a
 * visitor without JavaScript staring at a permanently blank page, so the first
 * frame lives behind a class that an inline script adds and a 4s timer takes
 * back off. No JS, or a motion.js that never loads: the class is never added
 * or is removed again, and the page is simply visible.
 *
 * The script self-skips on ?noanim and prefers-reduced-motion, mirroring the
 * runtime's own `still` gate — otherwise it would hide the page from exactly
 * the visitors who then get no animation to reveal it.
 */
function transitionHead(enter) {
  const first = cssDecls(initialStyle(splitByStagger(compileAnimation(enter)).element))
  if (!first) return ''
  return (
    `<style>html.gt-enter body{${first}}</style>` +
    `<script>(function(){` +
    `if(/[?&]noanim\\b/.test(location.search))return;` +
    `if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;` +
    `var h=document.documentElement;h.classList.add('gt-enter');` +
    `setTimeout(function(){h.classList.remove('gt-enter')},4000)})()</script>`
  )
}

/** wrap author JS in a <script>, escaping any literal </script so it can't break out */
function scriptTag(js) {
  return js && js.trim() ? `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>` : ''
}

/** the shared head + body-open shell for every exported page */
function renderShell(
  project,
  rewrite,
  { locale, title, description, path, headScript, bodyAttrs, motionHead },
) {
  const settings = project.settings ?? {}
  const seo = settings.seo ?? {}
  const rawDomain = String(settings.domain ?? '').trim().toLowerCase()
  const domain = EXPORT_HOSTNAME_RE.test(rawDomain) ? rawDomain : ''
  const absolute = (rel) => (domain && rel?.startsWith('/') ? `https://${domain}${rel}` : rel)

  let head =
    `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>`
  if (description) head += `<meta name="description" content="${escapeHtml(description)}">`
  head += `<meta property="og:title" content="${escapeHtml(title)}">`
  if (seo.siteName) head += `<meta property="og:site_name" content="${escapeHtml(seo.siteName)}">`
  if (description) head += `<meta property="og:description" content="${escapeHtml(description)}">`
  // same scheme allowlist as every other URL sink (FINDINGS S15)
  const ogImage = rewrite(seo.ogImage)
  if (ogImage && SAFE_SRC.test(ogImage))
    head += `<meta property="og:image" content="${escapeHtml(absolute(ogImage))}">`
  const favicon = rewrite(settings.favicon)
  if (favicon && SAFE_SRC.test(favicon)) head += `<link rel="icon" href="${escapeHtml(favicon)}">`
  const faviconDark = rewrite(settings.faviconDark)
  if (faviconDark && SAFE_SRC.test(faviconDark))
    head += `<link rel="icon" href="${escapeHtml(faviconDark)}" media="(prefers-color-scheme: dark)">`
  if (domain && path) head += `<link rel="canonical" href="${escapeHtml(`https://${domain}${path}`)}">`
  // schema.org JSON-LD: site identity + WebSite + this WebPage. Media paths
  // pass through the same rewrite + allowlist as og:image.
  head += structuredDataTag(
    buildStructuredData({
      seo,
      site: domain ? `https://${domain}` : '',
      path,
      locale,
      title,
      description,
      absolute: (rel) => {
        const r = rewrite(rel)
        return r && SAFE_SRC.test(r) ? absolute(r) : undefined
      },
    }),
  )
  head += `<link rel="stylesheet" href="/assets/style.css">`
  const fontsUrl = settings.fonts?.googleFontsUrl
  if (fontsUrl?.startsWith('https://fonts.googleapis.com/')) {
    head += `<link rel="stylesheet" href="${escapeHtml(fontsUrl)}">`
  }
  // registered webfonts — the same @font-face CSS useThemeTokens injects in the
  // editor, with library refs rewritten to the exported (hashed) file paths so
  // the site carries its own fonts and stays portable
  const faces = fontFaceBlock(settings, rewrite)
  if (faces) head += `<style>${faces}</style>`
  // the page-enter first frame, before the owner's own head code so they can
  // still override it
  if (motionHead) head += motionHead
  // owner-authored raw head HTML, last — same trust level as the site itself
  if (settings.customCode?.head) head += settings.customCode.head
  if (headScript) head += headScript // per-page head script
  head += `</head>`

  // font-family + layout/color defaults come from @layer base (baseBodyCss);
  // bodyAttrs carries the body NODE's classes/id/interactions/background
  return head + `<body${bodyAttrs ?? ''}>`
}

/** resolve {field} tokens in a SEO string against a collection entry
 * (locale overrides win over base values); a token whose field is empty or
 * non-text is left as the literal "{field}". */
function interpolateEntry(str, entry, locale, defaultLocale) {
  if (!str || !entry || !str.includes('{')) return str
  const overrides = locale && locale !== defaultLocale ? (entry.locales?.[locale] ?? {}) : {}
  return str.replace(/\{([a-zA-Z0-9_-]+)\}/g, (m, field) => {
    const v = overrides[field] ?? entry.values?.[field]
    return v != null && v !== '' && typeof v !== 'object' ? String(v) : m
  })
}

function renderPage(route, project, media, channels) {
  const { page, locale, scope, outPath } = route
  const ctx = {
    project,
    locale,
    defaultLocale: project.defaultLocale,
    scope,
    pagePath: page.path,
    // the page being rendered — what `excludeCurrent` drops from an @pages list
    pageId: page.id,
    // the locale-less path of THIS route (entry routes live at the collection
    // path, not the template page's) — what '@locale:xx' re-prefixes
    routePath: scope?.entry ? entryRoutePath(scope.collection, scope.entry) : page.path,
    mm: buildMasterMap(page.elements, project.components),
    plainTargets: buildPlainTargets(page, project),
    plainAnimTargets: buildPlainAnimTargets(page, project),
    // node id → its enclosing entry scope, which decides whether a binding's
    // state key carries the entry part (see attrsFor)
    scopeRoots: routeScopeRoots(page, project),
    // animation id → the saved timeline, for emitting only what's used
    animLib: new Map((project.animations ?? []).map((a) => [a.id, a])),
    // animation id → timeline, populated as bindings are emitted
    animUsed: {},
    // animation key → breakpoint ids it's scoped to (absent = all)
    animBp: {},
    // site-wide default replay mode for appear bindings that don't set one
    appearDefault: project.settings?.motion?.appearMode,
    // saved-interaction id → animation, for resolving bindings to timing/classes
    anim: new Map((project.interactions ?? []).map((a) => [a.id, a])),
    // state key (interactionId:targetId[@scope]) → the classes it applies
    fx: {},
    // state key → breakpoint ids it's scoped to (absent = all breakpoints)
    fxbp: {},
    // state keys proven unscoped (at least one binding covers all breakpoints),
    // so a later scoped binding can't re-gate them
    fxbpAll: new Set(),
    // state key → base classes removed from its target while fired
    fxrm: {},
    // state keys whose effect is a MODAL: while one is on, the runtime locks
    // page scroll, traps focus in the target and sets aria-modal
    fxModal: {},
    // sliders rendered on this route — a Set so it survives the `{...ctx}`
    // spread every nested scope makes (same reason fx/animUsed are objects)
    sliderIds: new Set(),
    // forms rendered on this route → the manifest the endpoint validates
    // against. A Map for the same reason sliderIds is a Set: it must survive
    // the `{...ctx}` spread every nested scope makes.
    forms: new Map(),
    // where a published page reaches this instance. Empty = the same host,
    // which is what the `server` publish method is; a zip/github site is
    // served elsewhere and carries the studio's public origin.
    apiOrigin: apiOriginOf(project),
    channels,
    rewrite: media.rewrite,
    altFor: media.altFor,
    kindFor: media.kindFor,
    sizeFor: media.sizeFor,
    srcsetFor: media.srcsetFor,
    // how many <img> this route has emitted so far — the first one is the
    // eager/high-priority slot, every later one is lazy. An OBJECT for the
    // same reason sliderIds is a Set: it has to survive the `{...ctx}` spread
    // every nested scope makes, which a number would not.
    imgCount: { n: 0 },
  }
  // the body node renders as the document <body> itself: children inline,
  // classes/id/interactions/background on the real tag (a video background
  // becomes the first child layer, like any other host)
  const bodyNode = page.elements.find((n) => n.type === 'body') ?? null
  const roots = bodyNode ? bodyNode.children : page.elements
  const body = roots.map((node) => renderNode(node, ctx)).join('')
  let bodyAttrs = ''
  let bodyBgLayer = ''
  if (bodyNode) {
    const bg = backgroundFor(bodyNode, ctx)
    // the body renders as the <body> tag itself — no linkWrap, so nothing hoists
    bodyAttrs = attrsFor(bodyNode, ctx, bg, { wrapLink: false })
    if (bg?.kind === 'video') {
      bodyBgLayer = `<video src="${escapeHtml(bg.url)}" autoplay muted loop playsinline class="${escapeHtml(bg.layerClass)}"></video>`
    }
  }
  const hasInteractions = Object.keys(ctx.fx).length > 0
  // A form needs the runtime for its own reasons (the fetch submit, the
  // success/error swap, the ?form=sent landing), and a page can carry a form
  // with no interactions at all — which is why this is its own term rather
  // than something `hasInteractions` could stand in for. Same shape as the
  // slider gate below.
  const needsRuntime = hasInteractions || ctx.forms.size > 0

  // --- site-wide motion (settings.motion): page transitions + smooth scroll ---
  // Transition timelines join the page's animation library under their own ids
  // (reserved ones for presets), so they ride the existing #anim-lib wire
  // format. Registered here, after the body render, but before the tags below
  // ask whether this route animates at all.
  const siteMotion = project.settings?.motion
  const transition = resolveTransition(siteMotion, Object.fromEntries(ctx.animLib))
  const siteFx = {}
  if (transition) {
    siteFx.t = {}
    if (transition.exit) {
      ctx.animUsed[transition.exit.id] = transition.exit
      siteFx.t.x = transition.exit.id
    }
    if (transition.enter) {
      ctx.animUsed[transition.enter.id] = transition.enter
      siteFx.t.e = transition.enter.id
    }
  }
  const scrollLerp = resolveScrollLerp(siteMotion)
  if (scrollLerp !== null) siteFx.s = { l: scrollLerp }
  const hasSiteFx = Object.keys(siteFx).length > 0
  const jsonTag = (id, data) =>
    `<script type="application/json" id="${id}">${JSON.stringify(data).replaceAll('</', '<\\/')}</script>`
  const fxTag = hasInteractions ? jsonTag('int-fx', ctx.fx) : ''
  const rmTag = Object.keys(ctx.fxrm).length ? jsonTag('int-fxrm', ctx.fxrm) : ''
  const hasAnimations = Object.keys(ctx.animUsed).length > 0
  // breakpoint-scoped bindings (either system) need the width→breakpoint map
  const hasBpScope = Object.keys(ctx.fxbp).length > 0 || Object.keys(ctx.animBp).length > 0
  const bpTag = hasBpScope
    ? jsonTag('int-bp', (project.breakpoints ?? []).map((b) => ({ id: b.id, w: b.width })))
    : ''
  const fxbpTag = Object.keys(ctx.fxbp).length ? jsonTag('int-fxbp', ctx.fxbp) : ''
  const modalTag = Object.keys(ctx.fxModal).length
    ? jsonTag('int-modal', Object.keys(ctx.fxModal))
    : ''
  // only the timelines this route actually plays — an unused library entry
  // never reaches the wire
  // smooth scroll alone carries no timelines, and still needs the runtime
  const animTag =
    hasAnimations || hasSiteFx
      ? (hasAnimations
          ? jsonTag('anim-lib', ctx.animUsed) +
            (Object.keys(ctx.animBp).length ? jsonTag('anim-bp', ctx.animBp) : '')
          : '') +
        (hasSiteFx ? jsonTag('site-fx', siteFx) : '') +
        '<script src="/assets/motion.js" defer></script>'
      : ''
  // the slider runtime ships only on routes that actually carry one
  const sliderTag = ctx.sliderIds.size ? '<script src="/assets/slider.js" defer></script>' : ''
  const tail =
    (needsRuntime || hasAnimations ? `${fxTag}${rmTag}${bpTag}${fxbpTag}${modalTag}` : '') +
    (needsRuntime ? '<script src="/assets/script.js" defer></script>' : '') +
    animTag +
    sliderTag
  // per-locale seo overrides (page + project) apply on non-default routes,
  // falling back field-by-field to the base values
  const localized = locale !== project.defaultLocale
  const baseSeo = project.settings?.seo ?? {}
  const seo = localized ? { ...baseSeo, ...(baseSeo.locales?.[locale] ?? {}) } : baseSeo
  // per-entry SEO (on a collection template route) overrides the page's SEO
  const basePageSeo = localized ? { ...(page.seo ?? {}), ...(page.seo?.locales?.[locale] ?? {}) } : (page.seo ?? {})
  const pageSeo = { ...basePageSeo, ...(scope?.entry?.seo ?? {}) }
  let title = pageSeo.title ?? applyTitleTemplate(seo.titleTemplate, page.name)
  let description = pageSeo.description ?? seo.description ?? ''
  // on a collection template route, resolve {field} tokens in the SEO strings
  // against the entry being rendered (locale-aware) — so every article route
  // gets its own <title>. Unresolved tokens fall back to the literal text.
  if (scope?.entry) {
    title = interpolateEntry(title, scope.entry, locale, project.defaultLocale)
    description = interpolateEntry(description, scope.entry, locale, project.defaultLocale)
  }
  const shell = renderShell(project, media.rewrite, {
    locale,
    title,
    description,
    path: '/' + (outPath ?? '').replace(/index\.html$/, ''),
    headScript: scriptTag(page.customCode?.head),
    bodyAttrs,
    // only where /assets/motion.js is also emitted: the guard hides the page
    // until the runtime reveals it, so a route without the runtime must never
    // carry it (renderNotFound passes nothing, and navigates natively)
    motionHead: transition?.enter ? transitionHead(transition.enter) : '',
  })
  // owner-authored raw body HTML (site-wide, e.g. a tag manager's noscript),
  // then the per-page body script, last before </body> (DOM + runtime ready)
  const siteBody = project.settings?.customCode?.body ?? ''
  const html = `${shell}${bodyBgLayer}${body}${tail}${siteBody}${scriptTag(page.customCode?.body)}</body></html>`
  // the forms are returned, not written: the manifest must be assembled across
  // every route (one form in a repeat is one form rendered N times) and saved
  // only AFTER a successful export
  return { html, forms: ctx.forms, route: '/' + (outPath ?? '').replace(/index\.html$/, '') }
}

/** an https:// endpoint a form may post to off-instance. Anything else — a
 *  `javascript:` URL above all — renders as a plain form with no action. */
function isExternalPostUrl(value) {
  try {
    return new URL(String(value)).protocol === 'https:'
  } catch {
    return false
  }
}

/** does any page or master carry a form that accepts submissions? Decides
 *  whether the honeypot rule ships at all — a site with no form should not pay
 *  for it, which is also what keeps the corpus referee honest. */
function hasEnabledForm(project) {
  let found = false
  const scan = (nodes) =>
    walkNodes(nodes ?? [], (node) => {
      if (node.type === 'form' && formEnabled(node.form)) found = true
    })
  for (const page of project.pages ?? []) scan(page.elements)
  for (const def of project.components ?? []) if (def?.root) scan([def.root])
  return found
}

/** the public origin a published page posts to: the studio's own when the site
 *  is hosted elsewhere, empty (same host) for the `server` method */
function apiOriginOf(project) {
  const raw = String(project.settings?.publishing?.apiOrigin ?? '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return ''
    return url.origin
  } catch {
    // an unparseable origin falls back to the same host rather than emitting a
    // broken action — the publish warning names it
    return ''
  }
}

/**
 * Fold one route's forms into the manifest the endpoint validates against.
 *
 * The manifest is what makes the endpoint safe without trusting the request:
 * the server checks the posted `_route` and `_entry` against what was actually
 * EXPORTED, and allowlists field names against what the form actually
 * declared. Main may have moved on since, and a draft may not be published at
 * all — the visitor submitted the published page, so the published page is
 * what their submission is checked against.
 *
 * One form in a repeat is one form rendered on many routes, so `routes` and
 * `entries` accumulate across them.
 */
function collectManifest(manifest, forms, routePath, route) {
  for (const [id, { node, config, mm }] of forms) {
    const entry = manifest[id] ?? {
      name: formName(config),
      notify: config?.notify === true,
      forward: config?.forward === true,
      routes: [],
      entries: [],
      fields: [],
    }
    // the redirect is validated again here: `isInternalRoute` ran at write
    // time, but a blob can arrive by import, merge or agent without passing
    // any writer
    if (config?.redirect && isInternalRoute(config.redirect)) entry.redirect = config.redirect
    const path = routePath || '/'
    if (!entry.routes.includes(path)) entry.routes.push(path)
    if (route.scope?.entry?.id && !entry.entries.includes(route.scope.entry.id)) {
      entry.entries.push(route.scope.entry.id)
    }
    if (!entry.fields.length) {
      // read the fields the same way the Data panel does, instance layers
      // included — one implementation, or a field the author can see is a
      // field the server discards
      // the ROUTE's master map, not one rebuilt from the form: a form can sit
      // inside a component instance, and a map built from the form alone would
      // pair nothing
      const { fields } = collectFormFields(
        node,
        (child) => resolveNodeAttributes(child, mm?.get(child.id), undefined),
        {
          // renderNode never emits a hidden node, so its name must not reach
          // the manifest's allowlist either
          hidden: (child) => isNodeHidden(child, mm?.get(child.id)),
          // and an <option>'s value/text comes from the master when it sits
          // inside an instance — the same chain renderNode reads
          content: (child) => {
            const mapping = mm?.get(child.id)
            return (
              child.content ||
              (mapping ? [...mapping.mirrors, mapping.master].map((n) => n.content).find(Boolean) : '') ||
              ''
            )
          },
        },
      )
      entry.fields = fields
    }
    manifest[id] = entry
  }
}

function renderNotFound(project, rewrite) {
  const shell = renderShell(project, rewrite, {
    locale: project.defaultLocale,
    title: '404',
    description: '',
    path: '',
  })
  return (
    `${shell}<div class="flex flex-1 flex-col items-center justify-center gap-2">` +
    `<p class="text-4xl font-semibold">404</p>` +
    `<p class="text-sm text-neutral-500">This page could not be found.</p>` +
    `</div></body></html>`
  )
}

// ---------- routes ----------

function enumerateRoutes(project) {
  const routes = []
  const locales = ['', ...(project.locales ?? []).filter((l) => l !== project.defaultLocale)]

  for (const prefix of locales) {
    const locale = prefix || project.defaultLocale
    const dir = prefix ? `${safePath(prefix)}/` : ''

    for (const page of project.pages) {
      if (page.status !== 'published') continue
      // a collection template renders ONLY through its entries (next loop) —
      // its bare path used to export as a real route full of raw "{title}"
      // tokens and empty bound fields (crawlable junk). A dangling
      // collectionId (collection deleted) falls through as a plain page.
      if (page.collectionId && (project.collections ?? []).some((c) => c.id === page.collectionId)) continue
      const seg = safePath(page.path)
      const rel = seg ? `${seg}/` : ''
      routes.push({ outPath: `${dir}${rel}index.html`, page, locale, scope: null })
    }

    for (const collection of project.collections ?? []) {
      // a data-only collection renders inside other pages and owns no routes
      if (!hasDetailRoutes(collection)) continue
      const template = project.pages.find((p) => p.id === collection.templatePageId)
      if (!template || template.status !== 'published') continue
      const base = collectionRouteBase(collection)
      for (const entry of collection.entries) {
        // entries can be held back independently of their template page
        if ((entry.status ?? 'published') !== 'published') continue
        routes.push({
          outPath: `${dir}${base ? `${base}/` : ''}${safePath(entrySlug(entry))}/index.html`,
          page: template,
          locale,
          scope: { collection, entry },
        })
      }
    }
  }
  return routes
}

// ---------- top level ----------

/**
 * Resolve every `{{ENV.<NAME>_<KEY>}}` reference in the project's custom code
 * against the integrations store, and REFUSE the export over one that cannot
 * be resolved safely.
 *
 * Two refusals, both deliberate:
 *
 *   A SECRET key is never substituted. Custom code becomes a `<script>` on a
 *   public page, so printing a secret there publishes it to every visitor.
 *   Failing the publish is the only answer that cannot end in a leak — a
 *   warning would ship the page.
 *
 *   An UNKNOWN name is never substituted either. The alternative is shipping
 *   the literal `{{ENV.TYPO}}` to a visitor, where the author will not see it
 *   and the integration they meant to use silently does nothing.
 *
 * Only custom code is substituted — never node content. Content is data
 * written by site users; resolving references in it would make a CMS entry a
 * way to read the operator's plain keys.
 */
function resolveCustomCode(project, integrations) {
  const lookup = envLookup(integrations ?? [])
  const missing = new Set()
  const secrets = new Set()
  const sub = (text) => {
    if (!text || !String(text).includes('{{')) return text
    const r = substituteEnvRefs(text, lookup)
    for (const name of r.missing) missing.add(name)
    for (const name of r.secrets) secrets.add(name)
    return r.text
  }

  const settings = project.settings ?? {}
  const next = {
    ...project,
    settings: {
      ...settings,
      ...(settings.customCode
        ? {
            customCode: {
              ...settings.customCode,
              head: sub(settings.customCode.head),
              body: sub(settings.customCode.body),
            },
          }
        : {}),
    },
    pages: (project.pages ?? []).map((page) =>
      page.customCode
        ? {
            ...page,
            customCode: {
              ...page.customCode,
              head: sub(page.customCode.head),
              body: sub(page.customCode.body),
            },
          }
        : page,
    ),
  }

  if (secrets.size || missing.size) {
    const parts = []
    if (secrets.size) {
      parts.push(
        `${[...secrets].join(', ')} ${secrets.size === 1 ? 'is a secret key' : 'are secret keys'} — ` +
          'a secret cannot be printed into a page. Use it from a server feature instead',
      )
    }
    if (missing.size) {
      parts.push(
        `${[...missing].join(', ')} ${missing.size === 1 ? 'is not' : 'are not'} a key on any ` +
          'integration — check Settings → Integrations',
      )
    }
    const err = new Error(`custom code references keys it cannot use: ${parts.join('; ')}`)
    err.expose = true // safe to show: it names key NAMES, never a value
    throw err
  }
  return next
}

export async function exportSite(rawProject, outDir, { integrations } = {}) {
  // substitute (and refuse) BEFORE anything is written: a publish that would
  // leak a secret must not leave a half-written site behind
  const project = resolveCustomCode(rawProject, integrations)
  if (usesVariants(project)) await loadVariants()
  const media = await extractMedia(project)
  const css = await buildCss(collectCandidates(project), project.settings, {
    forms: hasEnabledForm(project),
  })
  const runtime = await readFile(RUNTIME)
  let motionRuntime = null
  try {
    motionRuntime = await readFile(MOTION_RUNTIME)
  } catch {
    // only fatal if a page actually animates — checked below
  }
  let sliderRuntime = null
  try {
    sliderRuntime = await readFile(SLIDER_RUNTIME)
  } catch {
    // only fatal if a page actually carries a slider — checked below
  }

  return await withStagingDir(outDir, async (tmp) => {
    const tmpAbs = resolve(tmp)
    let bytes = 0
    const write = async (rel, data) => {
      const file = join(tmp, rel)
      // hard backstop: never write outside the output dir, whatever the
      // (server-untrusted) page path / locale / collection name contained
      if (file !== tmpAbs && !file.startsWith(tmpAbs + sep)) {
        throw new Error(`export: refusing to write outside the output dir (${rel})`)
      }
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, data)
      bytes += typeof data === 'string' ? Buffer.byteLength(data) : data.length
    }

    await write('assets/style.css', css)
    await write('assets/script.js', runtime)
    await write('404.html', renderNotFound(project, media.rewrite))
    for (const [rel, buffer] of media.files) await write(rel, buffer)

    const routes = enumerateRoutes(project)
    // Channel bindings are PROJECT-wide, not route-wide: a listener on route A
    // has to carry the key a trigger declares in a component route B renders.
    // Built once, outside the route loop, and read by every listener.
    const channels = buildChannelIndex(project)
    const written = new Set()
    // render before writing: whether any route plays an animation decides
    // whether the tween runtime ships at all
    let usesMotion = false
    let usesSlider = false
    const rendered = []
    const manifest = {}
    for (const route of routes) {
      if (written.has(route.outPath)) continue // page paths win over entry collisions
      written.add(route.outPath)
      const { html, forms, route: routePath } = renderPage(route, project, media, channels)
      if (!usesMotion && html.includes('/assets/motion.js')) usesMotion = true
      if (!usesSlider && html.includes('/assets/slider.js')) usesSlider = true
      collectManifest(manifest, forms, routePath, route)
      rendered.push([route.outPath, html])
    }
    if (usesMotion) {
      if (!motionRuntime) {
        throw new Error(
          'motion runtime missing — run `npm run build:motion` to rebuild server/motion-runtime.js',
        )
      }
      await write('assets/motion.js', motionRuntime)
    }
    if (usesSlider) {
      if (!sliderRuntime) {
        throw new Error(
          'slider runtime missing — run `npm run build:slider` to rebuild server/slider-runtime.js',
        )
      }
      await write('assets/slider.js', sliderRuntime)
    }
    for (const [outPath, html] of rendered) await write(outPath, html)

    return { routes: written.size, bytes, forms: manifest }
  })
}
