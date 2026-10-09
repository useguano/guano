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
  Animation,
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
      if (info?.value) return { value: info.value, untranslated: !info.translated }
      return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
    }
    for (const source of chain.value) {
      const text = nodeContent(source)
      if (text.value) return { value: text.value, untranslated: !text.translated }
    }
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

  const hidden = computed(
    () => node.value.type !== 'body' && isNodeHidden(node.value, mapping.value),
  )

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

  const linkRaw = computed(() => {
    let raw = resolveInstanceValue(node.value, mapping.value, 'link')
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

  const scopeOfOwn = (binding: { targetId?: string | null }) =>
    scopeFor(selfOwnerId.value, binding.targetId ?? selfOwnerId.value)

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
    const bindings: { binding: AnimationBinding; animation: Animation }[] = []
    const collect = ({ binding }: { binding: AnimationBinding }) => {
      if (!animBindingActiveAt(binding, renderBreakpointId.value)) return
      const animation = animationFor(binding.animationId)
      if (animation) bindings.push({ binding, animation })
    }
    animTargets.value.forEach(collect)
    channelAnimTargets.value.forEach(collect)
    return motion.restValuesFor(bindings)
  })

  const motionStyle = computed(() => {
    const own = ownMotionValues.value
    const inherited = inheritedMotionValues.value
    const rest = restMotionValues.value
    if (!own && !inherited && !rest) return undefined
    return composeMotionStyle({ ...(rest ?? {}), ...(inherited ?? {}), ...(own ?? {}) })
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

  const ofTrigger = (trigger: InteractionTrigger) =>
    ((mapping.value ? mapping.value.master.interactions : node.value.interactions) ?? []).filter(
      (i) => i.trigger === trigger,
    )

  const interactionOwnerId = selfOwnerId

  const instanceScope = computed(() => mapping.value?.instanceId)

  function applyIn(binding: InteractionBinding, on?: boolean) {
    applyBinding(binding, interactionOwnerId.value, scopeOfOwn(binding), instanceScope.value, on)
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

  function fireChangeInteractions(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null
    if (!target) return
    const on =
      'checked' in target && (target.type === 'checkbox' || target.type === 'radio')
        ? target.checked
        : !!target.value
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

  const { isPreview } = useViewMode()
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
