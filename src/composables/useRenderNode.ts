import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ELEMENTS } from '@/lib/elements'
import { declaresOwnBox } from '@/lib/emptyBox'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import {
  channelAnimationDrivers,
  useInteraction,
  type ScopeOf,
} from './useInteraction'
import { useComponents } from './useComponents'
import { useAnimation, animBindingActiveAt, scopedAnimBindings } from './useAnimation'
import { COLOR_MODE_ATTR, isThemeLink, themeLinkAction } from '@/lib/shared/colorMode.js'
import { bindingScope, entryScopePart } from '@/lib/shared/entryScope.js'
import { resolveFieldAttrs, cssVarsFromFields, formatFieldValue } from '@/lib/shared/fields.js'
import { useMotion, type RestBinding } from './useMotion'
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
import {
  refDisplay,
  resolveBinding,
  resolveListScope,
  applyListQuery,
  mediaUrls,
  parseAggregate,
  aggregateValue,
} from '@/lib/shared/fields.js'
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
import {
  isBareWrapper,
  isNodeHidden,
  resolveInstanceValue,
  wrapperIsTransparent,
} from '@/lib/instances'
import { isComponentType } from '@/lib/components'
import { variantClassesFor } from './useVariants'
import type {
  AnimationBinding,
  CollectionEntry,
  ElementNode,
  InteractionBinding,
  InteractionTrigger,
} from '@/types/editor'

export interface LocalizedDisplay {
  value: string | undefined
  untranslated: boolean
}

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

export function useRenderNode(
  getNode: () => ElementNode,
  opts?: {
    fieldPlaceholders?: boolean
    /** render the pre-play frame of the timelines aimed at a node, the way the
     * published page ships it. Play only — see `restMotionValues` */
    restingMotion?: boolean
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
  const { isPreview } = useViewMode()
  const { pages, activePage } = usePage()
  const { project, liveBreakpointId } = useProject()
  const siteAppearMode = computed(() => project.value.settings?.motion?.appearMode)

  const frameBreakpointId = inject(FRAME_BREAKPOINT, null)
  const shownPicks = inject(VARIANT_PICKS, null)
  const renderBreakpointId = computed(() => frameBreakpointId ?? liveBreakpointId.value)

  const frameWidth = computed(
    () => project.value.breakpoints.find((b) => b.id === frameBreakpointId)?.width ?? null,
  )
  const { collections, collectionByName, activeCollection, activeEntry, entryPath } = useCollections()
  const { nodeContent, nodeSrc, localeAttributes, entryValue, setNodeContent, setEntryValue, activeLocale } =
    useLocale()
  const { assetForSrc } = useMedia()

  const def = computed(() => ELEMENTS[node.value.type])

  const mapping = computed(() => masterFor(node.value.id))

  const chain = computed<ElementNode[]>(() =>
    mapping.value
      ? [node.value, ...mapping.value.mirrors, mapping.value.master]
      : [node.value],
  )

  const scope = inject(entryKey, null)

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
  const listQuery = computed(() => resolveInstanceValue(node.value, mapping.value, 'listQuery'))
  const listEntries = computed<CollectionEntry[]>(() =>
    applyListQuery(listScope.value?.entries ?? [], listQuery.value, {
      currentEntryId:
        listScope.value?.collection.id === '@pages'
          ? activePage.value.id
          : (scope?.entry ?? activeEntry.value)?.id,
    }),
  )

  /**
   * An AGGREGATE binding: a number over a list rather than a field of one
   * entry. Resolved through the SAME resolveListScope + applyListQuery the list
   * it labels uses, so a column header saying "3" and its column cannot
   * disagree.
   */
  const aggregate = computed(() => parseAggregate(node.value.arg))
  const aggregateText = computed(() => {
    const agg = aggregate.value
    if (!agg) return null
    const list = resolveListScope(
      collections.value,
      scope?.collection ?? activeCollection.value,
      scope?.entry ?? activeEntry.value,
      agg.source,
      pages.value,
    )
    if (!list) return ''
    const entries = applyListQuery(
      list.entries,
      resolveInstanceValue(node.value, mapping.value, 'listQuery'),
      {
        currentEntryId:
          list.collection.id === '@pages'
            ? activePage.value.id
            : (scope?.entry ?? activeEntry.value)?.id,
      },
    )
    return aggregateValue(entries, agg.op, agg.field)
  })

  const listTemplateChildren = computed(() =>
    node.value.children.filter((c) => c.type !== 'list-empty'),
  )
  const listEmptyChildren = computed(() =>
    node.value.children.filter((c) => c.type === 'list-empty'),
  )

  const isSlider = computed(() => node.value.type === 'slider')
  const sliderConfig = computed(() =>
    isSlider.value ? resolveInstanceValue(node.value, mapping.value, 'slider') : undefined,
  )
  const sliderBound = computed(() => isSlider.value && !!listCollection.value)
  const sliderTrackClass = computed(() =>
    sliderTrackClasses(sliderConfig.value, project.value.breakpoints, {
      ...(frameWidth.value !== null ? { width: frameWidth.value } : {}),
    }),
  )
  const sliderResolved = computed(() =>
    resolveSliderConfig(sliderConfig.value, project.value.breakpoints),
  )

  const sliderLabels = computed(() =>
    node.value.type === 'slider'
      ?
        resolveSliderLabels(
          resolveNodeAttributes(node.value, mapping.value, localeAttributes(node.value)) as Record<
            string,
            string
          >,
        )
      : SLIDER_LABELS,
  )
  const sliderDotLabelAt = (i: number) => sliderDotLabel(sliderLabels.value.dot, i)
  const sliderWire = computed(() => sliderWireData(sliderConfig.value, sliderLabels.value))

  const isForm = computed(() => node.value.type === 'form')

  const formConfig = computed(() =>
    isForm.value ? resolveInstanceValue(node.value, mapping.value, 'form') : undefined,
  )

  const formStateChildren = computed(() =>
    node.value.children.filter((c) => FORM_STATE_TYPES.includes(c.type)),
  )
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
  const selfNested = computed(
    () => !!scope && !!itemCollection.value && scope.collection.id === itemCollection.value.id,
  )

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

  const customAttrs = computed(() => {
    const own = withSafeRel(
      sanitizeAttributes(
        resolveNodeAttributes(node.value, mapping.value, localeAttributes(node.value)),
      ),
    )
    const attrs: Record<string, string> = { ...(def.value?.attrs ?? {}), ...own }
    if (isCurrentLink.value && !attrs['aria-current']) attrs['aria-current'] = 'page'
    // renderer-owned, like the export's (a reserved name, so it can never
    // collide with an authored one). Emitted on both surfaces so the DOM an
    // author inspects is the DOM that ships; only Play acts on the click.
    if (themeAction.value) attrs[COLOR_MODE_ATTR] = themeAction.value
    if (node.value.type === 'slider') {
      for (const name of Object.keys(SLIDER_LABEL_ATTRS)) delete attrs[name]
    }
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

  /** CSS custom properties bound to fields — the one way a NUMBER reaches a
   *  style. Merged into the style the renderers bind, beside the background. */
  const boundVars = computed<Record<string, string>>(() => {
    const bound = resolveInstanceValue(node.value, mapping.value, 'fieldAttrs') as
      | Record<string, string>
      | undefined
    if (!bound || !scope?.entry) return {}
    return cssVarsFromFields(bound, scope.collection, (field) =>
      entryValue(scope.entry!, field as never).value ?? '',
    )
  })

  const backgroundInfo = computed(() => {
    const styleNode = mapping.value ? mapping.value.master : node.value
    const bg = styleNode.background || undefined
    if (!bg || !SAFE_SRC.test(bg)) return null
    const asset = assetForSrc(bg)
    const mediaKind = asset ? kindOfMime(asset.mime) : null
    const kind =
      mediaKind === 'image' || mediaKind === 'video' ? mediaKind : backgroundKindFromUrl(bg)
    const tokens = (styleNode.classes ?? '').split(/\s+/).filter(Boolean)
    return backgroundRender(kind, bg, tokens)
  })

  const contentInfo = computed<LocalizedDisplay>(() => {
    if (aggregateText.value !== null) {
      return { value: aggregateText.value, untranslated: false }
    }
    if (boundField.value) {
      if (['reference', 'multi-reference'].includes(boundField.value.type)) {
        const names = boundEntry.value
          ? refDisplay(collections.value, boundField.value, boundEntry.value)
          : ''
        if (names) return { value: names, untranslated: false }
        return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
      }
      if (boundField.value.type === 'multi-image') {
        return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
      }
      const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value) : null
      if (info?.value) {
        // the `|format` suffix on the path, applied where the field resolves
        return {
          value: formatFieldValue(
            info.value,
            boundField.value,
            binding.value?.format ?? null,
            activeLocale.value || undefined,
          ),
          untranslated: !info.translated,
        }
      }
      return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
    }
    for (const source of chain.value) {
      const text = nodeContent(source)
      if (text.value) return { value: text.value, untranslated: !text.translated }
    }
    // `defaultContent` is an EDITOR PLACEHOLDER, like the empty box and the
    // Layers eye: it gives a fresh element something to see and click, and it
    // ships nowhere. An empty <span> used as a colour dot, a badge dot or a
    // toggle knob otherwise published "Dolor sit amet" on every one of them,
    // and the canvas gave no hint that it would — the placeholder looked
    // exactly like content someone had typed.
    if (isPreview.value) return { value: '', untranslated: false }
    // A leaf whose own classes declare a box is geometry, not words: the
    // placeholder would spill out of a size-2 dot and read as text the person
    // cannot delete. Same rule as the empty box — a box of its own needs no
    // affordance to be seen or clicked.
    const styleNode = mapping.value ? mapping.value.master : node.value
    if (declaresOwnBox(styleNode.classes ?? '')) return { value: '', untranslated: false }
    return { value: def.value?.defaultContent, untranslated: false }
  })
  const displayContent = computed(() => motionText.value ?? contentInfo.value.value)

  const richContent = computed(() =>
    isRich(displayContent.value) ? sanitizeRich(displayContent.value) : null,
  )

  const srcInfo = computed<LocalizedDisplay>(() => {
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

  const hidden = computed(() => {
    if (node.value.type === 'body') return false
    if (node.value.editorHidden === true && !isPreview.value) return true
    return isNodeHidden(node.value, mapping.value)
  })

  const iconInfo = computed(() => {
    if (node.value.type !== 'icon') return null
    const stored = chain.value.find((source) => source.svg)?.svg
    const safe = stored ? sanitizeInlineSvg(stored) : ''
    return parseInlineSvg(safe || DEFAULT_ICON_SVG)
  })

  const altAttr = computed(() =>
    def.value?.tag === 'img'
      ? (customAttrs.value.alt ?? assetForSrc(srcAttr.value)?.alt ?? '')
      : undefined,
  )

  const editableText = computed(
    () =>
      def.value?.defaultContent !== undefined &&
      node.value.type !== 'custom-code' &&
      !node.value.children.length &&
      (!boundField.value ||
        (!!boundEntry.value && !['reference', 'multi-reference'].includes(boundField.value.type))),
  )

  const richEditing = computed(() => richContent.value !== null)

  function inlineInitialText() {
    const placeholder =
      !!boundField.value &&
      !!boundEntry.value &&
      !entryValue(boundEntry.value, boundField.value).value
    return placeholder ? '' : (displayContent.value ?? '')
  }

  function commitInlineText(text: string) {
    if (boundField.value && boundEntry.value) {
      setEntryValue(boundEntry.value, boundField.value.name, text)
    } else {
      setNodeContent(node.value, text)
    }
  }

  const routePath = computed(() => {
    const entry = scope?.entry ?? activeEntry.value
    const collection = scope?.collection ?? activeCollection.value
    return (entry && collection ? entryPath(collection, entry) : activePage.value.path) || '/'
  })

  /**
   * The colour-mode switcher this node declares (`@theme`, `@theme:dark`, …).
   * A switch is not a navigation, so it never becomes an href — the published
   * page carries `data-guano-theme` and the head script delegates the click.
   */
  const themeAction = computed(() =>
    themeLinkAction(resolveInstanceValue(node.value, mapping.value, 'link')),
  )

  const linkRaw = computed(() => {
    let raw = resolveInstanceValue(node.value, mapping.value, 'link')
    if (isThemeLink(raw)) return null
    if (raw === '@item') {
      if (!scope?.entry) return null
      raw = entryPath(scope.collection, scope.entry) ?? undefined
    }
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

  const isCurrentLink = computed(() => {
    const raw = linkRaw.value
    if (!raw || !raw.startsWith('/')) return false
    return raw === routePath.value
  })

  const listensOn = computed(() => {
    const declared = (mapping.value ? mapping.value.master : node.value).channel
    return isChannelName(declared) ? declared : undefined
  })

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
    const removed = interactionCls
      ? new Set(conflictingBaseClasses(own.split(/\s+/).filter(Boolean), interactionCls))
      : null
    const kept = removed
      ? own.split(/\s+/).filter(Boolean).filter((t) => !removed.has(t)).join(' ')
      : own
    const bareComponentRoot = isBareWrapper(
      node.value,
      mapping.value ? mapping.value.master : node.value,
      {
        classes: own,
        targeted: targetedByEffect.value,
      },
    )
    return [
      node.value.type === 'body' && 'flex-1',
      // `contents` whenever a component wrapper has no classes of its own —
      // not only when it is BARE. A wrapper that emits an element purely
      // because something is bound to it must still be layout-transparent, or
      // binding a <Button> would wrap it in a real block and move the page.
      isComponentType(node.value.type) &&
        wrapperIsTransparent(node.value) &&
        'contents',
      bareComponentRoot && 'contents',
      kept,
      interactionCls,
      backgroundInfo.value?.hostClass,
    ]
  })

  const { animationFor, animTargetIndex } = useAnimation()
  const motion = useMotion()

  const selfOwnerId = computed(() => (mapping.value ? mapping.value.master.id : node.value.id))

  const scopeFor = (ownerId: string, targetId: string) =>
    isChannelTarget(targetId)
      ? undefined
      : bindingScope(
          mapping.value?.instanceId ?? null,
          entryScopePart(scopeRoots.value, ownerId, targetId, scope?.entry?.id),
        )

  const scopeOfTarget: ScopeOf = (ownerId) => scopeFor(ownerId, selfOwnerId.value)

  /** the bindings this node declares ITSELF, as a page node would — only an
   *  instance wrapper has any (see firedBindings) */
  const ownWrapperBindingIds = computed(
    () =>
      new Set(
        mapping.value && isComponentType(node.value.type)
          ? (node.value.interactions ?? []).map((b) => b.id)
          : [],
      ),
  )

  /**
   * A WRAPPER's own binding belongs to the PAGE, not to the component it
   * holds, so it keys with no instance part — exactly as a plain page
   * element's does. Scoped per instance (which is what every other binding
   * inside an instance needs), the trigger wrote `X:target@<instanceId>` while
   * a page target listened on `X:target`: the keys never matched and the click
   * did nothing, with every tool reporting success.
   */
  const ownerOf = (binding: { id?: string }) =>
    binding.id && ownWrapperBindingIds.value.has(binding.id)
      ? node.value.id
      : selfOwnerId.value

  const scopeOfOwn = (binding: { id?: string; targetId?: string | null }) =>
    binding.id && ownWrapperBindingIds.value.has(binding.id)
      ? undefined
      : scopeFor(selfOwnerId.value, binding.targetId ?? selfOwnerId.value)

  const selfScope = computed(() => scopeFor(selfOwnerId.value, selfOwnerId.value))

  const animTriggers = computed(
    () => (mapping.value ? mapping.value.master.animations : node.value.animations) ?? [],
  )

  const animTargets = computed(() =>
    mapping.value
      ? scopedAnimBindings(mapping.value.master.id, mapping.value.root)
      : (animTargetIndex.value.get(node.value.id) ?? []),
  )

  const channelAnimTargets = computed(() => channelAnimationDrivers(listensOn.value))

  const animTargetScopes = computed(() => {
    const scopes = new Set<string | undefined>()
    for (const { ownerId } of animTargets.value) scopes.add(scopeFor(ownerId, selfOwnerId.value))
    return scopes
  })

  const ownMotionValues = computed(() => {
    const text = contentInfo.value.value
    const own = animTargets.value.length
      ? motion.valuesForNode(node.value.id, animTargetScopes.value, text)
      : undefined
    if (!channelAnimTargets.value.length) return own
    const viaChannel = motion.valuesForNode(channelTargetId(listensOn.value!), undefined, text)
    if (!viaChannel) return own
    return own ? { ...own, ...viaChannel } : viaChannel
  })

  const inheritedMotionValues = computed(() => {
    const parent = parentIndex.value.get(node.value.id)
    if (!parent) return undefined
    const parentTargetId = masterFor(parent.id)?.master.id ?? parent.id
    if (!motion.staggeredTargets.value.has(parentTargetId)) return undefined
    const index = parent.children.indexOf(node.value)
    if (index === -1) return undefined
    return motion.staggerValuesFor(parentTargetId, index, selfScope.value)
  })

  /** the bindings aimed at this node's parent — the staggered half moves THIS node */
  const parentAnimTargets = computed(() => {
    const parent = parentIndex.value.get(node.value.id)
    if (!parent || parent.children.indexOf(node.value) === -1) return []
    const parentMapping = masterFor(parent.id)
    return parentMapping
      ? scopedAnimBindings(parentMapping.master.id, parentMapping.root)
      : (animTargetIndex.value.get(parent.id) ?? [])
  })

  /**
   * The resting frame of every timeline aimed at this node — what it wears
   * before any of them plays, from the same helper the exporter bakes with.
   * Merged UNDER the playing values, so a property a play covers is the
   * play's and the rest is the `from`.
   *
   * Play ONLY, never the Build canvas or the components board: no trigger
   * fires on either (`animOf` returns nothing inside a breakpoint frame), so
   * priming there would leave an element whose timeline starts at opacity 0
   * permanently invisible on the surfaces it has to be edited from.
   */
  const restMotionValues = computed(() => {
    if (!opts?.restingMotion) return undefined
    const bindings: RestBinding[] = []
    const collect =
      (part: 'element' | 'staggered') =>
      ({ binding }: { binding: AnimationBinding }) => {
        if (!animBindingActiveAt(binding, renderBreakpointId.value)) return
        const animation = animationFor(binding.animationId)
        if (animation) bindings.push({ binding, animation, part })
      }
    animTargets.value.forEach(collect('element'))
    channelAnimTargets.value.forEach(collect('element'))
    // a staggered step aimed at the PARENT moves this node, so its `from` is
    // this node's resting state too — without it a staggered entrance rested
    // at its final value and snapped to the `from` on the first played frame
    parentAnimTargets.value.forEach(collect('staggered'))
    return motion.restValuesFor(bindings)
  })

  const motionStyle = computed(() => {
    const own = ownMotionValues.value
    const inherited = inheritedMotionValues.value
    const rest = restMotionValues.value
    const vars = boundVars.value
    const hasVars = Object.keys(vars).length > 0
    if (!own && !inherited && !rest) return hasVars ? { ...vars } : undefined
    const composed = composeMotionStyle({
      ...(rest ?? {}),
      ...(inherited ?? {}),
      ...(own ?? {}),
    })
    // field-bound custom properties ride the style object both renderers
    // already bind at every call site, so one merge here reaches all of them
    // — and they are LAST, since a bound measurement is data and a tween is
    // presentation: nothing a timeline writes is a custom property.
    return hasVars ? { ...(composed ?? {}), ...vars } : composed
  })

  const motionText = computed(() => {
    const own = ownMotionValues.value
    if (!own || reducedMotion()) return undefined
    return sampleText(own, activeLocale.value || undefined)
  })

  const isCanvasFrame = frameBreakpointId !== null

  const animOf = (trigger: string) =>
    isCanvasFrame
      ? []
      : animTriggers.value.filter(
          (b) => b.trigger === trigger && animBindingActiveAt(b, renderBreakpointId.value),
        )

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

  /**
   * The class bindings this node fires.
   *
   * Inside an instance they are the MASTER's — shared, so every instance fires
   * them. An instance WRAPPER is the one exception: its own bindings belong to
   * this placement alone ("open the modal from THIS Button"), while the master
   * root's still fire everywhere, so a wrapper fires both. Mirrors the
   * exporter's `triggers`.
   */
  const firedBindings = computed(() => {
    const shared = (mapping.value ? mapping.value.master.interactions : node.value.interactions) ?? []
    if (!mapping.value || !isComponentType(node.value.type)) return shared
    return [...shared, ...(node.value.interactions ?? [])]
  })

  const ofTrigger = (trigger: InteractionTrigger) =>
    firedBindings.value.filter((i) => i.trigger === trigger)

  const instanceScope = computed(() => mapping.value?.instanceId)

  function applyIn(binding: InteractionBinding, on?: boolean) {
    applyBinding(
      binding,
      ownerOf(binding),
      scopeOfOwn(binding),
      // an exclusive group on a wrapper's own binding is unscoped too, so one
      // group can span a page trigger and a wrapper trigger
      ownWrapperBindingIds.value.has(binding.id) ? undefined : instanceScope.value,
      on,
    )
  }

  const hoverHandlers = {
    mouseenter() {
      for (const binding of ofTrigger('hover')) applyIn(binding, true)
      for (const binding of animOf('hover')) playAnim(binding)
    },
    mouseleave() {
      for (const binding of ofTrigger('hover')) applyIn(binding, false)
      for (const binding of animOf('hover')) motion.reverse(binding, animTargetId(binding), scopeOfOwn(binding))
    },
  }
  function fireClickInteractions() {
    for (const binding of ofTrigger('click')) applyIn(binding)
    for (const binding of animOf('click')) clickAnim(binding)
  }

  /** the state a control's CURRENT value implies, independent of any event */
  function controlState(target: HTMLInputElement | HTMLSelectElement) {
    return 'checked' in target && (target.type === 'checkbox' || target.type === 'radio')
      ? target.checked
      : !!target.value
  }

  function fireChangeInteractions(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null
    if (!target) return
    const on = controlState(target)
    for (const binding of ofTrigger('change')) applyIn(binding, on)
    for (const binding of animOf('change')) {
      if (on) playAnim(binding)
      else motion.reverse(binding, animTargetId(binding), scopeOfOwn(binding))
    }
  }

  const el = ref<HTMLElement>()
  let observer: IntersectionObserver | null = null
  const appeared = new Set<string>()

  const involvedStateKeys = computed(() => {
    const triggered = firedBindings.value.map((b) =>
      bindingStateKey(b, ownerOf(b), scopeOfOwn(b)),
    )
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

  let scrollListener: (() => void) | null = null
  let registeredKeys: string[] = []

  const wantsAppear = computed(
    () => ofTrigger('appear').length > 0 || animOf('appear').length > 0,
  )
  const observe = () => {
    if (observer || !el.value) return
    const at = animOf('appear').find((b) => b.appearAt)?.appearAt
    observer = new IntersectionObserver((entries) => {
      const inView = entries.some((entry) => entry.isIntersecting)
      if (inView) {
        for (const binding of ofTrigger('appear')) applyIn(binding, true)
      }
      for (const binding of animOf('appear')) {
        const mode = effectiveAppearMode(binding.appearMode, siteAppearMode.value)
        if (inView) {
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
  watch(wantsAppear, (wants) => {
    if (wants) observe()
    else {
      observer?.disconnect()
      observer = null
    }
  })

  onMounted(() => {
    if (wantsAppear.value) observe()
    for (const binding of animOf('load')) playAnim(binding)
    for (const binding of ofTrigger('load')) applyIn(binding, true)

    // A `change` binding reflects its control's STATE, so it has to be read
    // once at load and not only when something moves. A radio that ships
    // `checked` fired nothing until you clicked elsewhere, so radio-driven
    // tabs opened with every panel closed — the one arrangement the markup
    // cannot be authored out of.
    if (el.value && (ofTrigger('change').length || animOf('change').length)) {
      const control = el.value as HTMLInputElement | HTMLSelectElement
      if ('type' in control && controlState(control)) {
        for (const binding of ofTrigger('change')) applyIn(binding, true)
        for (const binding of animOf('change')) playAnim(binding)
      }
    }

    if (el.value && involvedStateKeys.value.length) {
      registeredKeys = involvedStateKeys.value
      registerInteractionEl(registeredKeys, el.value)
    }

    const scrolled = ofTrigger('scrolled')
    const scrolledAnims = animOf('scrolled')
    if (scrolled.length || scrolledAnims.length) {
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
    boundVars,
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
    themeAction,
    baseClasses,
    hoverHandlers,
    fireClickInteractions,
    fireChangeInteractions,
    el,
  }
}
