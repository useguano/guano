import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ELEMENTS } from '@/lib/elements'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import {
  channelAnimationDrivers,
  useInteraction,
  type ScopeOf,
} from './useInteraction'
import { useComponents } from './useComponents'
import { useAnimation, animBindingActiveAt, scopedAnimBindings } from './useAnimation'
import { bindingScope, entryScopePart } from '@/lib/shared/entryScope.js'
import { resolveFieldAttrs } from '@/lib/shared/fields.js'
import { useMotion } from './useMotion'
import {
  appearRootMargin,
  composeMotionStyle,
  effectiveAppearMode,
  reducedMotion,
  sampleText,
} from '@/lib/motion'
import { useProject } from './useProject'
import { useViewMode } from './useViewMode'
import { FRAME_BREAKPOINT } from '@/components/editor/canvas/frameScope'
import { VARIANT_PICKS } from '@/components/editor/canvas/variantScope'
import { entryKey } from '@/components/shared/EntryScope.vue'
import { refDisplay, resolveBinding, resolveListScope, applyListQuery, mediaUrls } from '@/lib/shared/fields.js'
import { isRich, sanitizeRich } from '@/lib/shared/richtext.js'
import { backgroundRender, backgroundKindFromUrl } from '@/lib/shared/background.js'
import { conflictingBaseClasses } from '@/lib/shared/interactionClasses.js'
import {
  resolveSliderConfig,
  resolveSliderLabels,
  sliderDotLabel,
  sliderTrackClasses,
  sliderWireData,
  SLIDER_LABELS,
  SLIDER_LABEL_ATTRS,
} from '@/lib/shared/slider.js'
import { FORM_STATE_TYPES } from '@/lib/shared/forms.js'
import { useMedia, kindOfMime } from './useMedia'
import {
  resolveNodeAttributes,
  sanitizeAttributes,
  withSafeRel,
} from '@/lib/shared/attributes.js'
import {
  DEFAULT_SCROLL_AT,
  channelTargetId,
  isChannelName,
  isChannelTarget,
} from '@/lib/shared/interactionKeys.js'
import { useLocale } from './useLocale'
import { SAFE_SRC } from '@/lib/shared/urls.js'
import { DEFAULT_ICON_SVG, parseInlineSvg, sanitizeInlineSvg } from '@/lib/shared/svg.js'
import { isBareWrapper, isNodeHidden, resolveInstanceValue } from '@/lib/instances'
import { variantClassesFor } from './useVariants'
import type {
  CollectionEntry,
  ElementNode,
  InteractionBinding,
  InteractionTrigger,
} from '@/types/editor'

/** a resolved content/src value; `untranslated` marks a default-locale
 * fallback rendered under a non-default locale (the editor dims these) */
export interface LocalizedDisplay {
  value: string | undefined
  untranslated: boolean
}

/** child id → parent node for the active page — one shared O(tree) index per
 * structural change, instead of every rendered node running its own
 * findParent walk (that made motion ticks O(nodes²) across the canvas) */
const parentIndex = computed(() => {
  const map = new Map<string, ElementNode>()
  const visit = (nodes: ElementNode[], parent: ElementNode | null) => {
    for (const n of nodes) {
      if (parent) map.set(n.id, parent)
      visit(n.children, n)
    }
  }
  visit(usePage().activePage.value.elements, null)
  return map
})

/**
 * The rendering core shared VERBATIM by the editor's ElementRenderer and
 * Preview's PreviewRenderer (the published site is static HTML from
 * server/export.mjs, which mirrors this logic): element/tag resolution,
 * component master mapping, collection/entry-scope resolution, interaction
 * firing, the scroll-into-view observer, and the content/src/rich/link
 * resolution (bound field → own → mapped master → element
 * default). Each renderer keeps its own selection chrome, extra classes and
 * event handlers on top.
 */
export function useRenderNode(
  getNode: () => ElementNode,
  opts?: {
    /** editor only: a value-less field binding renders a {field}
     * placeholder instead of the site's empty string */
    fieldPlaceholders?: boolean
  },
) {
  const node = computed(getNode)

  const {
    applyBinding,
    bindingStateKey,
    classesFor,
    scopedClassesFor,
    targetStateKeys,
    scopedTargetStateKeys,
    scopeRoots,
    registerInteractionEl,
    unregisterInteractionEl,
    animationFor: interactionFor,
    isAnyFired,
  } = useInteraction()
  const { masterFor } = useComponents()
  const { pages, activePage } = usePage()
  const { project, liveBreakpointId } = useProject()
  /** site-wide default for appear bindings that don't set their own mode */
  const siteAppearMode = computed(() => project.value.settings?.motion?.appearMode)

  // the breakpoint this node is rendered for — the frame's id in the multi-frame
  // canvas, else the live viewport (Preview / published site). Drives which
  // breakpoint-scoped interactions contribute their classes.
  const frameBreakpointId = inject(FRAME_BREAKPOINT, null)
  // on the components board: the variant options this drawing wears
  const shownPicks = inject(VARIANT_PICKS, null)
  const renderBreakpointId = computed(() => frameBreakpointId ?? liveBreakpointId.value)
  /** the fixed width of the canvas frame this node renders in, null outside the
   * multi-frame canvas (Preview and the published site have a real viewport) */
  const frameWidth = computed(
    () => project.value.breakpoints.find((b) => b.id === frameBreakpointId)?.width ?? null,
  )
  const { collections, collectionByName, activeCollection, activeEntry, entryPath } = useCollections()
  const { nodeContent, nodeSrc, localeAttributes, entryValue, setNodeContent, setEntryValue, activeLocale } =
    useLocale()
  const { assetForSrc } = useMedia()

  const def = computed(() => ELEMENTS[node.value.type])

  // inside a component instance block, style/interactions come from the
  // shared master node; content stays this node's own
  const mapping = computed(() => masterFor(node.value.id))

  /** where this node's own state can come from, in order: itself, the mirrors
   *  held by the components it is nested in, then its master */
  const chain = computed<ElementNode[]>(() =>
    mapping.value
      ? [node.value, ...mapping.value.mirrors, mapping.value.master]
      : [node.value],
  )

  // --- collections / entry scope ---

  const scope = inject(entryKey, null)

  // a list arg names a collection (all entries), a multi-reference field of
  // the surrounding scope entry (the referenced entries), or a multi-image
  // field (one synthetic entry per stored image url).
  // A :slider repeats the same way, but its arg is optional — without one it
  // resolves to null and each direct child is a slide instead.
  const listScope = computed(() =>
    node.value.type === 'collection-list' || node.value.type === 'slider'
      ? resolveListScope(
          collections.value,
          scope?.collection ?? activeCollection.value,
          scope?.entry ?? activeEntry.value,
          node.value.arg,
          pages.value,
        )
      : null,
  )
  const listCollection = computed(() => listScope.value?.collection ?? null)
  // filter/sort/limit, the slider's chrome and a collection-item's pick are
  // PER-INSTANCE state with a component default — resolved along the chain
  // like content is, so a list extracted into a component keeps its filter
  // (which moved to the master with the rest of the node state) and one
  // instance can still narrow it differently
  const listQuery = computed(() => resolveInstanceValue(node.value, mapping.value, 'listQuery'))
  const listEntries = computed<CollectionEntry[]>(() =>
    applyListQuery(listScope.value?.entries ?? [], listQuery.value, {
      // for the @pages source the synthetic entry ids ARE page ids, so
      // excludeCurrent means "every page except this one" for free
      currentEntryId:
        listScope.value?.collection.id === '@pages'
          ? activePage.value.id
          : (scope?.entry ?? activeEntry.value)?.id,
    }),
  )
  /** a list's row TEMPLATE: its children minus the empty-state block, which is
   * never repeated */
  const listTemplateChildren = computed(() =>
    node.value.children.filter((c) => c.type !== 'list-empty'),
  )
  /** the empty-state block(s), rendered only when the list has no entries */
  const listEmptyChildren = computed(() =>
    node.value.children.filter((c) => c.type === 'list-empty'),
  )

  // --- slider (carousel) ---

  const isSlider = computed(() => node.value.type === 'slider')
  /** the slider's config — the instance's own, else what its component says */
  const sliderConfig = computed(() =>
    isSlider.value ? resolveInstanceValue(node.value, mapping.value, 'slider') : undefined,
  )
  /** true when the arg binds a real source, so slides come from entries */
  const sliderBound = computed(() => isSlider.value && !!listCollection.value)
  const sliderTrackClass = computed(() =>
    sliderTrackClasses(sliderConfig.value, project.value.breakpoints, {
      // canvas frames are fixed-width elements, so real max-width media
      // queries can't fire in them — resolve the cascade to a flat value
      ...(frameWidth.value !== null ? { width: frameWidth.value } : {}),
    }),
  )
  const sliderResolved = computed(() =>
    resolveSliderConfig(sliderConfig.value, project.value.breakpoints),
  )
  /** the chrome's own WORDS for this slider, per locale: the authored label
   *  attributes (SLIDER_LABEL_ATTRS) over the built-in English defaults. They
   *  were literals in both renderers' templates, so a French route showed
   *  "Previous slide" and no worklist ever offered them. */
  const sliderLabels = computed(() =>
    node.value.type === 'slider'
      ? // resolved here rather than from `customAttrs`, which STRIPS these four
        // (they are consumed, not rendered) — and gated on the type so no other
        // node pays for the call
        resolveSliderLabels(
          resolveNodeAttributes(node.value, mapping.value, localeAttributes(node.value)) as Record<
            string,
            string
          >,
        )
      : SLIDER_LABELS,
  )
  /** one dot's label — the runtime builds the rail, Preview mirrors it */
  const sliderDotLabelAt = (i: number) => sliderDotLabel(sliderLabels.value.dot, i)
  const sliderWire = computed(() => sliderWireData(sliderConfig.value, sliderLabels.value))

  // --- form ---

  const isForm = computed(() => node.value.type === 'form')
  /** the form's config — the instance's own, else what its component says.
   * Per-instance with a component default, exactly like `slider`/`listQuery`:
   * a Newsletter component holds the config on its master and one placement
   * can still turn notification off. */
  const formConfig = computed(() =>
    isForm.value ? resolveInstanceValue(node.value, mapping.value, 'form') : undefined,
  )
  /** a form's SUCCESS / ERROR children, which never render inline with the
   * fields — the renderers decide when to show them (never, on the published
   * site, until the runtime does) */
  const formStateChildren = computed(() =>
    node.value.children.filter((c) => FORM_STATE_TYPES.includes(c.type)),
  )
  /** the fields: everything that is not a state block */
  const formFieldChildren = computed(() =>
    node.value.children.filter((c) => !FORM_STATE_TYPES.includes(c.type)),
  )

  const itemCollection = computed(() =>
    node.value.type === 'collection-item' && node.value.arg ? collectionByName(node.value.arg) : null,
  )
  const itemEntry = computed(
    () =>
      itemCollection.value?.entries.find(
        (e) => e.id === resolveInstanceValue(node.value, mapping.value, 'entryId'),
      ) ?? null,
  )
  const itemTemplateChildren = computed(() => {
    const col = itemCollection.value
    const page = col ? pages.value.find((p) => p.id === col.templatePageId) : null
    return page?.elements.find((n) => n.type === 'body')?.children ?? []
  })
  /** a template embedding its own collection would recurse forever */
  const selfNested = computed(
    () => !!scope && !!itemCollection.value && scope.collection.id === itemCollection.value.id,
  )

  // a node bound to a field (:h1[title]:) shows the entry's value — from the
  // surrounding list/item scope, or the template's active entry. The binding
  // may hop one reference ('author.name'): boundField/boundEntry are the
  // RESOLVED field + entry the value actually lives on.
  const boundCollection = computed(() => scope?.collection ?? activeCollection.value)
  const binding = computed(() =>
    resolveBinding(
      collections.value,
      boundCollection.value,
      scope ? scope.entry : activeEntry.value,
      node.value.arg,
    ),
  )
  const boundField = computed(() => binding.value?.field ?? null)
  const boundEntry = computed(() => binding.value?.entry ?? null)

  // --- custom attributes (allowlisted; master-aware like style/classes) ---
  // withSafeRel mirrors the exporter: target="_blank" always carries a rel, so
  // the Data panel shows the same attribute set the published page will have
  const customAttrs = computed(() => {
    // every layer: the component master's (shared, like classes), then each
    // host mirror's say about the instance it holds, then THIS placement's
    // overrides, then the active locale's text. The last two are the node's
    // own, which is why they survive being inside an instance.
    const own = withSafeRel(
      sanitizeAttributes(
        resolveNodeAttributes(node.value, mapping.value, localeAttributes(node.value)),
      ),
    )
    // attributes the element TYPE implies (:checkbox → type="checkbox"); the
    // author's own value always wins
    const attrs: Record<string, string> = { ...(def.value?.attrs ?? {}), ...own }
    // aria-current marks the link pointing at the page being rendered — the
    // hook the `current:` variant styles. It has to come from the rendered
    // route, since a shared component's master cannot know which page its
    // instance is on. Mirrors ariaCurrentFor in server/export.mjs.
    if (isCurrentLink.value && !attrs['aria-current']) attrs['aria-current'] = 'page'
    // a slider's label attributes are CONSUMED, not rendered: they set the
    // chrome's aria-labels on the arrows and the dot rail, and the host would
    // otherwise carry four copies of the same text (the exporter's `managed`
    // set skips them for the same reason)
    if (node.value.type === 'slider') {
      for (const name of Object.keys(SLIDER_LABEL_ATTRS)) delete attrs[name]
    }
    // attribute values bound to collection fields, resolved in the entry scope
    // being rendered. Per-instance with a component default, like listQuery.
    const bound = resolveInstanceValue(node.value, mapping.value, 'fieldAttrs') as
      | Record<string, string>
      | undefined
    if (!bound || !scope?.entry) return attrs
    return resolveFieldAttrs(
      bound,
      scope.collection,
      (field) => entryValue(scope.entry!, field as never).value ?? '',
      attrs,
    )
  })

  // --- background media (image → CSS bg, video → layer); master-aware like style ---
  const backgroundInfo = computed(() => {
    const styleNode = mapping.value ? mapping.value.master : node.value
    const bg = styleNode.background || undefined
    if (!bg || !SAFE_SRC.test(bg)) return null
    const asset = assetForSrc(bg)
    const mediaKind = asset ? kindOfMime(asset.mime) : null
    // library assets resolve kind from their mime; external/data URLs infer it
    // (without the fallback, an https background silently rendered as nothing)
    const kind =
      mediaKind === 'image' || mediaKind === 'video' ? mediaKind : backgroundKindFromUrl(bg)
    const tokens = (styleNode.classes ?? '').split(/\s+/).filter(Boolean)
    return backgroundRender(kind, bg, tokens)
  })

  // --- content / src / rich / alt (shared precedence) ---

  const contentInfo = computed<LocalizedDisplay>(() => {
    if (boundField.value) {
      // a reference field bound directly (no `.field` hop) reads as the
      // referenced entry name(s)
      if (['reference', 'multi-reference'].includes(boundField.value.type)) {
        const names = boundEntry.value
          ? refDisplay(collections.value, boundField.value, boundEntry.value)
          : ''
        if (names) return { value: names, untranslated: false }
        return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
      }
      // a multi-image field holds an array of urls — never text. Bound to a
      // text element it shows the placeholder, not a stringified array.
      if (boundField.value.type === 'multi-image') {
        return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
      }
      const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value) : null
      if (info?.value) return { value: info.value, untranslated: !info.translated }
      return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
    }
    // own, then what each component this one is nested in says about it, then
    // its master — the first that says anything
    for (const source of chain.value) {
      const text = nodeContent(source)
      if (text.value) return { value: text.value, untranslated: !text.translated }
    }
    return { value: def.value?.defaultContent, untranslated: false }
  })
  const displayContent = computed(() => motionText.value ?? contentInfo.value.value)

  // rich content renders through the shared sanitizer via v-html
  const richContent = computed(() =>
    isRich(displayContent.value) ? sanitizeRich(displayContent.value) : null,
  )

  const srcInfo = computed<LocalizedDisplay>(() => {
    // a multi-image field bound straight to one :image (outside a
    // :collection-list) renders its FIRST url — the cover-image case
    if (boundField.value?.type === 'multi-image') {
      const first = boundEntry.value ? mediaUrls(boundEntry.value, boundField.value.name)[0] : undefined
      if (first) return { value: first, untranslated: false }
    }
    if (boundField.value?.type === 'image') {
      const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value) : null
      if (info?.value) return { value: info.value, untranslated: !info.translated }
    }
    const own = nodeSrc(node.value)
    if (own.value) return { value: own.value, untranslated: !own.translated }
    // inside a component instance, fall back to the mapped master's src —
    // same own-then-master precedence as content, so shared chrome (a logo)
    // is set once on the master and renders in every instance
    for (const source of chain.value.slice(1)) {
      const inherited = nodeSrc(source)
      if (inherited.value) return { value: inherited.value, untranslated: !inherited.translated }
    }
    return { value: undefined, untranslated: false }
  })
  const srcAttr = computed(() => {
    const v = srcInfo.value.value
    return v && SAFE_SRC.test(v) ? v : undefined
  })

  // --- hidden ---
  //
  // A hidden node renders nothing, on every surface: the canvas shows what the
  // site will. It stays in the Layers tree, which is where it is shown again.
  // Own flag first, then the component's — so one instance can drop a part
  // (or show one its component hides) without touching the others.
  const hidden = computed(
    () => node.value.type !== 'body' && isNodeHidden(node.value, mapping.value),
  )

  // --- inline icon ---
  //
  // The <svg> IS the element, so what the renderers need is its root
  // attributes and its inner markup, separately. Same own-then-master
  // precedence as `src`. It is sanitized HERE and not only where it is written:
  // the markup goes into the page through v-html, and a project blob can
  // arrive by import, by merge or from an agent without passing any writer.
  const iconInfo = computed(() => {
    if (node.value.type !== 'icon') return null
    const stored = chain.value.find((source) => source.svg)?.svg
    const safe = stored ? sanitizeInlineSvg(stored) : ''
    return parseInlineSvg(safe || DEFAULT_ICON_SVG)
  })

  // images carry alt: the author's attributes.alt wins over the library
  // asset's default (mirrors the static exporter)
  const altAttr = computed(() =>
    def.value?.tag === 'img'
      ? (customAttrs.value.alt ?? assetForSrc(srcAttr.value)?.alt ?? '')
      : undefined,
  )

  // --- inline text editing ---
  //
  // Which elements can be text-edited, and what an edit reads from and writes
  // to. Both renderers use these — the Build canvas (`ElementRenderer`) and, for
  // a contributor, the Play render (`PreviewRenderer`) — and they live here with
  // the content resolution they depend on (bound field, entry scope, locale
  // fallback) rather than beside the gesture, since that is the part the
  // field-type rules have to stay in step with.

  /** text-content elements only; a bound element needs an entry to write to —
   * and a reference bind isn't text, it's picked in the Data panel */
  const editableText = computed(
    () =>
      def.value?.defaultContent !== undefined &&
      // raw HTML is edited in the Data panel, never inline — a contenteditable
      // would hand it to the rich-text path and strip what makes it code
      node.value.type !== 'custom-code' &&
      !node.value.children.length &&
      (!boundField.value ||
        (!!boundEntry.value && !['reference', 'multi-reference'].includes(boundField.value.type))),
  )

  /** already-rich content keeps its formatting while inline-editing */
  const richEditing = computed(() => richContent.value !== null)

  /** a {field} placeholder starts empty; everything else starts from the
   * displayed text, so translating edits begin from the fallback */
  function inlineInitialText() {
    const placeholder =
      !!boundField.value &&
      !!boundEntry.value &&
      !entryValue(boundEntry.value, boundField.value).value
    return placeholder ? '' : (displayContent.value ?? '')
  }

  /** a bound element writes the entry field; everything else its own content */
  function commitInlineText(text: string) {
    if (boundField.value && boundEntry.value) {
      setEntryValue(boundEntry.value, boundField.value.name, text)
    } else {
      setNodeContent(node.value, text)
    }
  }

  // --- links ---

  // any element with a link navigates — not just <a>. '@item' resolves to
  // the current entry's page and is inert outside an entry scope. Same
  // scheme allowlist the static export enforces — drops javascript:,
  // data:, etc. Renderers turn the raw value into their own href/nav.
  /** the locale-less path of the route being rendered — what '@locale:xx'
   * re-prefixes, and what `isCurrentLink` compares against. Entry routes live
   * at the collection path, not the template page's. */
  const routePath = computed(() => {
    const entry = scope?.entry ?? activeEntry.value
    const collection = scope?.collection ?? activeCollection.value
    return (entry && collection ? entryPath(collection, entry) : activePage.value.path) || '/'
  })

  const linkRaw = computed(() => {
    // along the CHAIN (own → each mirror → master), not `?? master.link`: a
    // host's say about a nested instance lives on its mirror, which the two-step
    // read skipped entirely
    let raw = resolveInstanceValue(node.value, mapping.value, 'link')
    if (raw === '@item') {
      if (!scope?.entry) return null
      // null for a data-only collection (no detail routes) — render unlinked
      // rather than pointing at a route that was never exported
      raw = entryPath(scope.collection, scope.entry) ?? undefined
    }
    // '@locale:xx' — THIS route in another locale (the language switcher).
    // Mirrors resolveHref in server/export.mjs; Play's `navigate` reads the
    // locale back off the path, so the switch is the ordinary nav it already
    // does. The '@' is part of the sentinel, as it is for '@item' — without it
    // the link fell through the scheme test below and rendered no href at all.
    if (raw?.startsWith('@locale:')) {
      const code = raw.slice('@locale:'.length)
      if (!project.value.locales.includes(code)) return null
      const path = routePath.value
      return code === (project.value.defaultLocale || 'en')
        ? path
        : `/${code}${path === '/' ? '' : path}`
    }
    if (!raw) return null
    if (!/^(\/|#|https?:|mailto:|tel:)/i.test(raw)) return null
    return raw
  })

  /** does this element's link point at the page currently being rendered? */
  const isCurrentLink = computed(() => {
    const raw = linkRaw.value
    if (!raw || !raw.startsWith('/')) return false
    return raw === routePath.value
  })

  // --- classes (shared core; renderers append their own chrome) ---

  /**
   * The channel this element LISTENS on, if any — node state shared like
   * classes, so inside an instance it is the component master's. A channel
   * binding reaches it from anywhere in the project, which is what lets one
   * modal component be opened by a header component on every route.
   */
  const listensOn = computed(() => {
    const declared = (mapping.value ? mapping.value.master : node.value).channel
    return isChannelName(declared) ? declared : undefined
  })

  /**
   * Is anything AIMED at this node — a class effect or a tween — whether or not
   * it is firing right now? A targeted instance wrapper has to emit a real
   * element even while the effect is off, and `interactionCls` cannot say so:
   * it is empty exactly then. (Evaluated lazily, like `scopeOfTarget` below.)
   */
  const targetedByEffect = computed(() => {
    const keys = mapping.value
      ? scopedTargetStateKeys(
          mapping.value.master.id,
          mapping.value.root,
          scopeOfTarget,
          listensOn.value,
        )
      : targetStateKeys(node.value.id, scopeOfTarget, listensOn.value)
    return keys.length > 0 || animTargets.value.length > 0 || channelAnimTargets.value.length > 0
  })

  const baseClasses = computed(() => {
    // the master's classes inside an instance, with the instance's variant
    // options layered on (lib/variants) — or the node's own
    const own = variantClassesFor(node.value, mapping.value, shownPicks?.value)
    const interactionCls = mapping.value
      ? scopedClassesFor(
          mapping.value.master.id,
          mapping.value.root,
          scopeOfTarget,
          renderBreakpointId.value,
          listensOn.value,
        )
      : classesFor(node.value.id, renderBreakpointId.value, scopeOfTarget, listensOn.value)
    // parity with the published runtime (int-fxrm): own classes styling the
    // same property as an active interaction's classes are REMOVED, not
    // outweighed — the cascade would pick an arbitrary winner (hidden+flex)
    const removed = interactionCls
      ? new Set(conflictingBaseClasses(own.split(/\s+/).filter(Boolean), interactionCls))
      : null
    const kept = removed
      ? own.split(/\s+/).filter(Boolean).filter((t) => !removed.has(t)).join(' ')
      : own
    // a bare component :Name wrapper is a logical grouping — render it
    // layout-transparent (display:contents) so it adds no box, matching the
    // static export which emits no wrapper element at all. A
    // styled/interactive/targeted wrapper stays a real box.
    //
    // One shared predicate with the exporter and the published site: the two
    // used to check DIFFERENT keys, and the exporter's version ran before
    // attrsFor, so a wrapper it judged bare silently lost every attribute that
    // call would have written (see isBareWrapper).
    const bareComponentRoot = isBareWrapper(
      node.value,
      mapping.value ? mapping.value.master : node.value,
      {
        classes: own,
        // anything aimed at it needs a real element, whether or not it is
        // firing this frame — `interactionCls` is empty while the effect is off
        targeted: targetedByEffect.value,
      },
    )
    return [
      // the body fills its frame/viewport column
      node.value.type === 'body' && 'flex-1',
      bareComponentRoot && 'contents',
      kept,
      interactionCls,
      // background media makes the host relative (video layer) / applies bg image
      backgroundInfo.value?.hostClass,
    ]
  })

  // --- animations (tween engine) ---

  const { animationFor, animTargetIndex } = useAnimation()
  const motion = useMotion()

  /** bindings live on the master inside a component instance, so a binding's
   * "self target" is the master's id, not this instance node's */
  const selfOwnerId = computed(() => (mapping.value ? mapping.value.master.id : node.value.id))

  /**
   * The scope that isolates one rendering of a binding from its siblings: the
   * component instance, plus the entry when the binding's OWNER and its TARGET
   * share one entry scope (src/lib/shared/entryScope.js). Without the entry part
   * a hover on one card fires every repeat; with it keyed off the trigger alone,
   * a row button that opens the one shared overlay outside the list wrote
   * `X@e<row>` while the overlay listened on `X`, so the click did nothing.
   * Mirrors the export's key scope exactly.
   */
  const scopeFor = (ownerId: string, targetId: string) =>
    isChannelTarget(targetId)
      ? undefined
      : bindingScope(
          mapping.value?.instanceId ?? null,
          entryScopePart(scopeRoots.value, ownerId, targetId, scope?.entry?.id),
        )

  /** resolver for the bindings whose effect lands ON this node */
  const scopeOfTarget: ScopeOf = (ownerId) => scopeFor(ownerId, selfOwnerId.value)

  /** the scope of a binding this node declares */
  const scopeOfOwn = (binding: { targetId?: string | null }) =>
    scopeFor(selfOwnerId.value, binding.targetId ?? selfOwnerId.value)

  /** this node's own scope — what a self-targeting binding keys under */
  const selfScope = computed(() => scopeFor(selfOwnerId.value, selfOwnerId.value))

  /** animation bindings this node TRIGGERS (master-aware, like ofTrigger) */
  const animTriggers = computed(
    () => (mapping.value ? mapping.value.master.animations : node.value.animations) ?? [],
  )

  /** animation bindings whose animation MOVES this node */
  const animTargets = computed(() =>
    mapping.value
      ? scopedAnimBindings(mapping.value.master.id, mapping.value.root)
      : (animTargetIndex.value.get(node.value.id) ?? []),
  )

  /** the CLICK tweens aimed at this node's channel — kept apart from
   *  `animTargets` because their play is keyed by the channel, not by this
   *  node's id, so the values are read under a different target */
  const channelAnimTargets = computed(() => channelAnimationDrivers(listensOn.value))

  /** every scope the animations landing on this node key under — one per
   * binding, since the entry part follows the target */
  const animTargetScopes = computed(() => {
    const scopes = new Set<string | undefined>()
    for (const { ownerId } of animTargets.value) scopes.add(scopeFor(ownerId, selfOwnerId.value))
    return scopes
  })

  /** the node's own animated values (element-moving tracks only) */
  const ownMotionValues = computed(() => {
    // The AUTHORED text, not the rendered one: a `count` track's destination is
    // the number this node says, and `to` lives on the shared Animation, so
    // four instances of one StatCounter would otherwise all land on the
    // master's number. contentInfo is already resolved per instance and per
    // locale, which is why the canvas needs no equivalent of the runtime's
    // read-the-DOM-once cache — this value does not move while the play runs.
    const text = contentInfo.value.value
    const own = animTargets.value.length
      ? motion.valuesForNode(node.value.id, animTargetScopes.value, text)
      : undefined
    if (!channelAnimTargets.value.length) return own
    // a channel play is keyed by the CHANNEL and is always unscoped
    const viaChannel = motion.valuesForNode(channelTargetId(listensOn.value!), undefined, text)
    if (!viaChannel) return own
    return own ? { ...own, ...viaChannel } : viaChannel
  })

  /** values this node inherits as the Nth child of a STAGGERED parent —
   * only staggered tracks cascade, so one timeline can move the container
   * and stagger its children at the same time */
  const inheritedMotionValues = computed(() => {
    const parent = parentIndex.value.get(node.value.id)
    if (!parent) return undefined
    // inside a component instance the play is keyed on the MASTER's parent
    const parentTargetId = masterFor(parent.id)?.master.id ?? parent.id
    // gate BEFORE staggerValuesFor: only children of an actually-staggering
    // parent subscribe to the frame clock — otherwise every node on the page
    // recomputes (and walked the tree) on every animation frame
    if (!motion.staggeredTargets.value.has(parentTargetId)) return undefined
    const index = parent.children.indexOf(node.value)
    if (index === -1) return undefined
    return motion.staggerValuesFor(parentTargetId, index, selfScope.value)
  })

  /** inline style for the frame currently being rendered */
  const motionStyle = computed(() => {
    const own = ownMotionValues.value
    const inherited = inheritedMotionValues.value
    if (!own && !inherited) return undefined
    return composeMotionStyle({ ...(inherited ?? {}), ...(own ?? {}) })
  })

  /**
   * The TEXT a `count` track writes this frame, or undefined. The one track
   * that is not style — `displayContent` prefers it while a play is running,
   * and falls back to the authored content, which IS the final value. Nothing
   * is written in reduced motion, exactly as the published runtime's `still`
   * mode leaves the text alone.
   */
  const motionText = computed(() => {
    const own = ownMotionValues.value
    if (!own || reducedMotion()) return undefined
    return sampleText(own, activeLocale.value || undefined)
  })

  // Build's breakpoint frames are an EDITING surface: animation bindings never
  // auto-fire there (no load/appear entrances, no hover/click tweens, no
  // marquees looping under the editor). They play in Preview and on the
  // published site; the Animations panel's explicit ▶ preview still works in
  // Build because it bypasses the triggers (motion.preview renders through
  // motionStyle regardless).
  const isCanvasFrame = frameBreakpointId !== null

  const animOf = (trigger: string) =>
    isCanvasFrame
      ? []
      : animTriggers.value.filter(
          (b) => b.trigger === trigger && animBindingActiveAt(b, renderBreakpointId.value),
        )

  /** resolves a binding's target node id — null means the trigger itself */
  const animTargetId = (binding: { targetId: string | null }) =>
    binding.targetId ?? (mapping.value ? mapping.value.master.id : node.value.id)

  function playAnim(binding: (typeof animTriggers.value)[number], reverse = false) {
    const animation = animationFor(binding.animationId)
    if (!animation) return
    motion.play(binding, animation, animTargetId(binding), {
      scope: scopeOfOwn(binding),
      reverse,
    })
  }
  function clickAnim(binding: (typeof animTriggers.value)[number]) {
    const animation = animationFor(binding.animationId)
    if (!animation) return
    motion.clickAction(binding, animation, animTargetId(binding), scopeOfOwn(binding))
  }

  // --- interactions ---

  const ofTrigger = (trigger: InteractionTrigger) =>
    ((mapping.value ? mapping.value.master.interactions : node.value.interactions) ?? []).filter(
      (i) => i.trigger === trigger,
    )

  /** the state key's "self target" — see selfOwnerId */
  const interactionOwnerId = selfOwnerId

  /** the component-instance part of the scope only. Exclusive groups key on this
   * and NOT on the collection-list repeat, so one accordion open at a time holds
   * across a list's items while two component instances stay independent. */
  const instanceScope = computed(() => mapping.value?.instanceId)

  /** apply a binding in this node's scope. `on` forces a direction; omitting it
   * honours the binding's action (toggle / on / off). */
  function applyIn(binding: InteractionBinding, on?: boolean) {
    applyBinding(binding, interactionOwnerId.value, scopeOfOwn(binding), instanceScope.value, on)
  }

  // ready-made hover handlers — renderers spread these into their own
  // handlers object; click stays per-renderer (selection/nav differ)
  const hoverHandlers = {
    mouseenter() {
      for (const binding of ofTrigger('hover')) applyIn(binding, true)
      for (const binding of animOf('hover')) playAnim(binding)
    },
    mouseleave() {
      for (const binding of ofTrigger('hover')) applyIn(binding, false)
      // hover-out rewinds rather than cutting, so the element eases back
      for (const binding of animOf('hover')) motion.reverse(binding, animTargetId(binding), scopeOfOwn(binding))
    },
  }
  function fireClickInteractions() {
    for (const binding of ofTrigger('click')) applyIn(binding)
    for (const binding of animOf('click')) clickAnim(binding)
  }

  /** a form control's 'change' trigger: on while checked / non-empty, so an
   * "Other" radio can reveal its text field. Symmetric, and the tween engine
   * answers it the same way — forward while the condition holds, rewound when
   * it stops. */
  function fireChangeInteractions(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null
    if (!target) return
    const on =
      'checked' in target && (target.type === 'checkbox' || target.type === 'radio')
        ? target.checked
        : !!target.value
    for (const binding of ofTrigger('change')) applyIn(binding, on)
    // the tween engine answers the same condition the same way
    for (const binding of animOf('change')) {
      if (on) playAnim(binding)
      else motion.reverse(binding, animTargetId(binding), scopeOfOwn(binding))
    }
  }

  // fire 'appear' interactions the first time the element scrolls into view
  const el = ref<HTMLElement>()
  let observer: IntersectionObserver | null = null
  /** appear animations that already played, so 'once' really means once */
  const appeared = new Set<string>()

  /** every state key this node participates in — the ones it triggers and the
   * ones whose effect lands on it. Registered so an outside-click dismissal can
   * tell a pointerdown inside an open menu from one outside it. */
  const involvedStateKeys = computed(() => {
    const triggered = (
      (mapping.value ? mapping.value.master.interactions : node.value.interactions) ?? []
    ).map((b) => bindingStateKey(b, interactionOwnerId.value, scopeOfOwn(b)))
    const targeted = mapping.value
      ? scopedTargetStateKeys(
          mapping.value.master.id,
          mapping.value.root,
          scopeOfTarget,
          listensOn.value,
        )
      : targetStateKeys(node.value.id, scopeOfTarget, listensOn.value)
    return [...new Set([...triggered, ...targeted])]
  })

  // --- modal behaviour on the editing surfaces ---
  //
  // The published runtime (server/site-runtime.js) locks page scroll, traps
  // focus and sets aria-modal while a `modal` effect is on. Here only the
  // FOCUS half and the aria attributes are mirrored, deliberately: the
  // preview pane is not `window`, and locking the admin shell's scroll while
  // an author opens their dialog would be wrong. What the author gets is the
  // focus ring landing where a visitor's will.
  //
  // Play only. On the Build canvas a click fires interactions too, and
  // stealing focus there would pull it out of whatever the author is typing in.
  const { isPreview } = useViewMode()
  /** the state keys landing on this node whose effect is a modal */
  const modalKeys = computed(() => {
    const targeted = mapping.value
      ? scopedTargetStateKeys(
          mapping.value.master.id,
          mapping.value.root,
          scopeOfTarget,
          listensOn.value,
        )
      : targetStateKeys(node.value.id, scopeOfTarget, listensOn.value)
    return targeted.filter((key) => interactionFor(key.slice(0, key.indexOf(':')))?.modal)
  })
  /** the attributes WE set, so closing gives back exactly what was there */
  let modalAria: string[] = []
  let modalOpener: HTMLElement | null = null
  watch(
    () => isPreview.value && modalKeys.value.length > 0 && isAnyFired(modalKeys.value),
    (on) => {
      const host = el.value
      if (!host) return
      if (on) {
        modalOpener = document.activeElement as HTMLElement | null
        modalAria = []
        for (const [name, value] of [
          ['role', 'dialog'],
          ['aria-modal', 'true'],
          ['tabindex', '-1'],
        ] as const) {
          if (host.hasAttribute(name)) continue
          host.setAttribute(name, value)
          modalAria.push(name)
        }
        // the open classes land in the same tick; focus after the paint, or
        // the panel is still `display: none` and focus() silently does nothing
        requestAnimationFrame(() => {
          const first = host.querySelector<HTMLElement>(
            'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
          )
          ;(first ?? host).focus()
        })
      } else {
        for (const name of modalAria) host.removeAttribute(name)
        modalAria = []
        if (modalOpener && document.contains(modalOpener)) modalOpener.focus()
        modalOpener = null
      }
    },
  )

  /** 'scrolled' bindings: on while the page is scrolled past their threshold.
   * A window listener, so it reflects real page scroll in Preview and on the
   * published site; the Build canvas pans instead of scrolling, where this is
   * inert by nature. */
  let scrollListener: (() => void) | null = null
  let registeredKeys: string[] = []

  /** does anything on this node wait for it to scroll into view? Only then is
   * an observer worth having: one per rendered element — three frames of a
   * page holding thousands — was the single largest cost of opening a page */
  const wantsAppear = computed(
    () => ofTrigger('appear').length > 0 || animOf('appear').length > 0,
  )
  const observe = () => {
    if (observer || !el.value) return
    // an appearAt threshold delays firing until the element's top has travelled
    // that far down the viewport (0.8 ≈ ScrollTrigger's 'top 80%'); the
    // published runtime uses the same rootMargin
    const at = animOf('appear').find((b) => b.appearAt)?.appearAt
    observer = new IntersectionObserver((entries) => {
      const inView = entries.some((entry) => entry.isIntersecting)
      if (inView) {
        // appear fires once and never unfires
        for (const binding of ofTrigger('appear')) applyIn(binding, true)
      }
      for (const binding of animOf('appear')) {
        // a binding without its own mode inherits the site default
        // (settings.motion.appearMode); the exporter resolves the same way
        const mode = effectiveAppearMode(binding.appearMode, siteAppearMode.value)
        if (inView) {
          // once: first entry only. replay: every entry.
          // reverse: plays in, rewinds out.
          if (mode === 'once' && appeared.has(binding.id)) continue
          appeared.add(binding.id)
          playAnim(binding)
        } else if (mode === 'reverse') {
          motion.reverse(binding, animTargetId(binding), scopeOfOwn(binding))
        }
      }
    }, at ? { rootMargin: appearRootMargin(at) } : undefined)
    observer.observe(el.value)
  }
  // a binding added while the element is on screen still gets its observer
  watch(wantsAppear, (wants) => {
    if (wants) observe()
    else {
      observer?.disconnect()
      observer = null
    }
  })

  onMounted(() => {
    if (wantsAppear.value) observe()
    // 'load' plays as soon as the element exists
    for (const binding of animOf('load')) playAnim(binding)
    // 'load' on a class change is on from the first frame and never off
    for (const binding of ofTrigger('load')) applyIn(binding, true)

    if (el.value && involvedStateKeys.value.length) {
      registeredKeys = involvedStateKeys.value
      registerInteractionEl(registeredKeys, el.value)
    }

    const scrolled = ofTrigger('scrolled')
    const scrolledAnims = animOf('scrolled')
    if (scrolled.length || scrolledAnims.length) {
      // the tween engine answers `scrolled` the same way the class one does,
      // so each play is started or rewound only when the threshold is actually
      // crossed — a scroll event must not restart a timeline mid-flight
      const past = new Map<string, boolean>()
      scrollListener = () => {
        const y = window.scrollY
        for (const binding of scrolled) applyIn(binding, y > (binding.scrollAt ?? DEFAULT_SCROLL_AT))
        for (const binding of scrolledAnims) {
          const on = y > (binding.scrollAt ?? DEFAULT_SCROLL_AT)
          if (past.get(binding.id) === on) continue
          past.set(binding.id, on)
          if (on) playAnim(binding)
          else motion.reverse(binding, animTargetId(binding), scopeOfOwn(binding))
        }
      }
      window.addEventListener('scroll', scrollListener, { passive: true })
      scrollListener()
    }
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    if (scrollListener) window.removeEventListener('scroll', scrollListener)
    if (registeredKeys.length && el.value) unregisterInteractionEl(registeredKeys, el.value)
  })

  return {
    def,
    mapping,
    motionStyle,
    listCollection,
    listEntries,
    listTemplateChildren,
    listEmptyChildren,
    isSlider,
    sliderBound,
    sliderConfig,
    sliderResolved,
    sliderLabels,
    sliderDotLabelAt,
    sliderTrackClass,
    sliderWire,
    isForm,
    formConfig,
    formStateChildren,
    formFieldChildren,
    itemCollection,
    itemEntry,
    itemTemplateChildren,
    selfNested,
    boundField,
    boundEntry,
    customAttrs,
    backgroundInfo,
    contentInfo,
    displayContent,
    richContent,
    srcInfo,
    srcAttr,
    altAttr,
    iconInfo,
    hidden,
    editableText,
    richEditing,
    inlineInitialText,
    commitInlineText,
    linkRaw,
    baseClasses,
    hoverHandlers,
    fireClickInteractions,
    fireChangeInteractions,
    el,
  }
}
