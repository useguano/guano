import { computed, ref } from 'vue'
import { usePage } from './usePage'
import { useProject } from './useProject'
import { walkNodes } from '@/lib/tree'
import { masterInteractionsTargeting } from './useMasterBindings'
import {
  channelTargetId,
  interactionGroupKey,
  interactionStateKey,
  isChannelTarget,
  nextInteractionState,
} from '@/lib/shared/interactionKeys.js'
import { buildChannelIndex } from '@/lib/shared/channels.js'
import { buildScopeRoots } from '@/lib/shared/entryScope.js'
import type { AnimationBinding, ElementNode, Interaction, InteractionBinding } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

/**
 * State keys currently active. A state key is `interactionId:targetId[@scope]`
 * (see lib/shared/interactionKeys.js) — NOT a binding id. That is what lets an
 * "open" button and a "close" button drive the same effect: they share one
 * boolean. Keyed by binding, a close button flipped its own independent flag and
 * the to-classes were applied twice, so modals could never be closed.
 */
const fired = ref(new Set<string>())

/** exclusive groups: group key → the one state key currently open in it */
const firedGroups = new Map<string, string>()

/** state keys that are open AND dismissable, → the gestures that dismiss them */
const openDismissals = new Map<string, Set<string>>()

/** state key → the DOM elements that count as "inside" it (its triggers and its
 * targets), for outside-click hit-testing. Populated by the renderers. */
const dismissEls = new Map<string, Set<HTMLElement>>()

/** binding(s) waiting for a canvas click to choose a target element.
 * Holds the binding objects themselves (not ids) so they resolve even when the
 * binding lives on a component master, which isn't in the page tree. Shared by
 * interaction AND animation bindings — both carry a targetId — and an ARRAY
 * when one row drives both halves of a mixed effect, which must land on the
 * same element or the class change and the timeline would part company. */
type Pickable = InteractionBinding | AnimationBinding
const pickingFor = ref<Pickable | Pickable[] | null>(null)

/** the binding objects a pending pick would write to */
function pendingPicks(): Pickable[] {
  const pending = pickingFor.value
  if (!pending) return []
  return Array.isArray(pending) ? pending : [pending]
}

/** drop a pending pick that names this binding — it would otherwise land its
 *  targetId on a binding that no longer exists */
export function cancelPickFor(bindingId: string) {
  if (pendingPicks().some((b) => b.id === bindingId)) pickingFor.value = null
}

// These derive from the active page and are read once per rendered node
// (classesFor). They live at MODULE scope — one shared computed each —
// so N renderer nodes don't each build their own tree-walking computed
// (that was O(n²) CPU + N Maps rebuilt on every edit). usePage()/useProject()
// only wire computeds over singleton refs, so it's safe to call here.
const { activePage } = usePage()
const { project } = useProject()

/** saved-interaction id → its animation, for resolving bindings */
const animationIndex = computed(() => {
  const index = new Map<string, Interaction>()
  for (const animation of project.value.interactions ?? []) index.set(animation.id, animation)
  return index
})

/** every binding on the page, paired with the node that triggers it */
const all = computed(() => {
  const list: { owner: ElementNode; binding: InteractionBinding }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.interactions ?? []) list.push({ owner: node, binding })
  })
  return list
})

/** node id → bindings whose effect applies to that node, each paired with the
 * node it is declared on (the owner decides the binding's entry scope) */
const targetIndex = computed(() => {
  const index = new Map<string, { binding: InteractionBinding; ownerId: string }[]>()
  for (const { owner, binding } of all.value) {
    const key = binding.targetId ?? owner.id
    const list = index.get(key) ?? []
    list.push({ binding, ownerId: owner.id })
    index.set(key, list)
  }
  return index
})

/**
 * Every binding in the PROJECT aimed at a channel, grouped by name.
 *
 * Project-wide rather than active-page, deliberately: the point of a channel
 * is that the trigger and the listener need not share a tree, so a modal
 * component on this page is driven by a header component's binding that the
 * active page's walk would never see.
 */
const channelIndex = computed(() => buildChannelIndex(project.value))

/** the interaction bindings driving a channel, in the shape the renderers use */
export function channelInteractionDrivers(channel: string | undefined): Driver[] {
  if (!channel) return []
  return (channelIndex.value.get(channel)?.interactions ?? []) as Driver[]
}

/** the CLICK animation bindings driving a channel — the one tween key that can
 *  be shared, so the only trigger a channel accepts */
export function channelAnimationDrivers(channel: string | undefined): AnimDriver[] {
  if (!channel) return []
  return ((channelIndex.value.get(channel)?.animations ?? []) as AnimDriver[]).filter(
    (d) => d.binding.trigger === 'click',
  )
}

/**
 * node id → the entry scope it renders under, for the active page and every
 * component master (shared/entryScope.js). Mirrors the exporter's index: it is
 * what keeps a row trigger and a shared overlay on ONE state key.
 */
const scopeRoots = computed(() =>
  buildScopeRoots([
    { tree: activePage.value.elements, root: null },
    ...(project.value.components ?? []).map((c) => ({ tree: [c.root], root: null })),
  ]),
)

/**
 * Per-EFFECT options, folded together from every binding that drives the same
 * target. These belong to the effect, not to the trigger that declares them: a
 * close button can carry `closeOn` and an overlay can carry the `group` while
 * the effect is the one an open button fires. Reading them off the firing
 * binding alone meant a dismissal declared on an `action: 'off'` button was
 * never armed — that button never turns the effect ON, which is when dismissal
 * has to be registered.
 *
 * Keyed by target node id (the state key's target half). Built over the active
 * page AND every component master, since bindings on masters aren't in the page
 * tree but do render.
 */
const effectOptions = computed(() => {
  const index = new Map<string, { closeOn: Set<string>; group?: string }>()
  const collect = (owner: ElementNode) => {
    for (const binding of owner.interactions ?? []) {
      if (!binding.closeOn?.length && !binding.group) continue
      const targetId = binding.targetId ?? owner.id
      const entry = index.get(targetId) ?? { closeOn: new Set<string>() }
      for (const mode of binding.closeOn ?? []) entry.closeOn.add(mode)
      if (binding.group && !entry.group) entry.group = binding.group
      index.set(targetId, entry)
    }
  }
  walkNodes(activePage.value.elements, collect)
  for (const component of project.value.components ?? []) walkNodes([component.root], collect)
  // channel effects fold project-wide: the close button carrying `closeOn` may
  // be on another page entirely, and the effect is one effect
  for (const [name, drivers] of channelIndex.value) {
    const targetId = channelTargetId(name)
    for (const { binding } of drivers.interactions) {
      if (!binding.closeOn?.length && !binding.group) continue
      const entry = index.get(targetId) ?? { closeOn: new Set<string>() }
      for (const mode of binding.closeOn ?? []) entry.closeOn.add(mode)
      if (binding.group && !entry.group) entry.group = binding.group
      index.set(targetId, entry)
    }
  }
  return index
})

/** a binding paired with the node that declares it */
export type Driver = { binding: InteractionBinding; ownerId: string }
/** the same, for the tween engine */
export type AnimDriver = { binding: AnimationBinding; ownerId: string }

/**
 * Is this effect a STATE worth naming — one a discrete gesture drives, or one
 * some OTHER element drives?
 *
 * Answers for BOTH engines — a class change and a timeline are both keyed per
 * (effect, target) on a click, so both can be driven by several triggers.
 *
 * A symmetric effect on itself (a hover lift, a scrolled-past header) has no
 * state to manage: nothing opens it, nothing dismisses it, and no second
 * trigger would ever join it. The panel's States block and the action picker's
 * list of states to join MUST agree on this, or the picker would offer to
 * "Open" something the panel never calls a state — and a page of forty hover
 * cards would bury the one modal that matters.
 */
export function isDrivenState(
  targetId: string,
  drivers: { binding: { trigger: string }; ownerId: string }[],
): boolean {
  return drivers.some((d) => d.binding.trigger === 'click' || d.ownerId !== targetId)
}

/**
 * Target node id → every interaction binding whose effect LANDS on it, paired
 * with the node that declares it. The "Driven by" half of the panel's States
 * block: which elements can put this one into a state, and therefore where the
 * one canonical `closeOn` / `group` / `once` is written.
 *
 * Built over the active page AND every component master, exactly like
 * `effectOptions` — a binding on a master is not in the page tree but does
 * render. It is computed LAZILY and read only by the panel (one element at a
 * time), never per rendered element: the renderers use `targetIndex` and
 * `masterInteractionsTargeting`, which are indexed for that.
 *
 * Never cached on the target node: an agent's write runs `clearBindingsTo`, so
 * a trigger can disappear between reads.
 */
const driversIndex = computed(() => {
  const index = new Map<string, Driver[]>()
  const collect = (owner: ElementNode) => {
    for (const binding of owner.interactions ?? []) {
      const targetId = binding.targetId ?? owner.id
      const list = index.get(targetId) ?? []
      list.push({ binding, ownerId: owner.id })
      index.set(targetId, list)
    }
  }
  walkNodes(activePage.value.elements, collect)
  for (const component of project.value.components ?? []) walkNodes([component.root], collect)
  return index
})

/**
 * Resolves the scope of a binding declared on `ownerId`, for the node being
 * rendered. Per BINDING, not per node: a row trigger and the one shared overlay
 * it opens only land on the same state key when the entry part follows the
 * TARGET (src/lib/shared/entryScope.js).
 */
export type ScopeOf = (ownerId: string) => string | undefined

/** whether a binding applies at the breakpoint being rendered. `undefined`
 * breakpoints = all; a null render breakpoint (unknown) never gates. */
export function bindingActiveAt(binding: InteractionBinding, breakpointId: string | null): boolean {
  if (!binding.breakpoints || breakpointId === null) return true
  return binding.breakpoints.includes(breakpointId)
}

/** replace the fired set (Vue needs a new Set to see the change) */
function rawSet(key: string, on: boolean) {
  if (on === fired.value.has(key)) return
  const next = new Set(fired.value)
  if (on) next.add(key)
  else next.delete(key)
  fired.value = next
}

// --- outside-click / Escape dismissal ---
//
// One pair of capture-phase document listeners, installed the first time a
// dismissable interaction opens. Both the Build canvas and Preview run this:
// click interactions already fire in both, so dismissal has to as well or a menu
// opened on the canvas could never be closed.

let dismissListening = false

function elementsFor(key: string): HTMLElement[] {
  return [...(dismissEls.get(key) ?? [])]
}

function closeDismissable(key: string) {
  openDismissals.delete(key)
  // a dismissed interaction also vacates any exclusive group slot it held
  for (const [groupKey, stateKey] of firedGroups) {
    if (stateKey === key) firedGroups.delete(groupKey)
  }
  rawSet(key, false)
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!openDismissals.size) return
  const target = event.target as Node | null
  if (!target) return
  for (const [key, modes] of [...openDismissals]) {
    if (!modes.has('outside')) continue
    // inside the trigger or inside the thing that opened — not an outside click
    if (elementsFor(key).some((el) => el.contains(target))) continue
    closeDismissable(key)
  }
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !openDismissals.size) return
  for (const [key, modes] of [...openDismissals]) {
    if (modes.has('escape')) closeDismissable(key)
  }
}

function installDismissListeners() {
  if (dismissListening || typeof document === 'undefined') return
  dismissListening = true
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onDocumentKeyDown, true)
}

export function useInteraction() {
  /**
   * Classes a target node receives: the transition setup is always on (so both
   * directions animate), the To-classes only while the effect is active.
   *
   * Deduped by INTERACTION, not by binding — several bindings (an open button, a
   * close button, an overlay) drive one effect on one target, so its classes are
   * contributed once. Without the dedupe the to-classes appeared N times.
   */
  function classesFor(
    nodeId: string,
    breakpointId: string | null = null,
    scopeOf: ScopeOf = () => undefined,
    channel?: string,
  ): string {
    const targeting = targetIndex.value.get(nodeId)
    const onChannel = channelInteractionDrivers(channel)
    if (!targeting?.length && !onChannel.length) return ''
    const seen = new Set<string>()
    const parts: string[] = []
    const take = (binding: InteractionBinding, key: string) => {
      if (!bindingActiveAt(binding, breakpointId)) return
      if (seen.has(binding.interactionId)) return
      seen.add(binding.interactionId)
      const animation = animationIndex.value.get(binding.interactionId)
      if (!animation) return
      const base = `transition-all ${animation.duration} ${animation.easing}`
      parts.push(fired.value.has(key) ? `${base} ${animation.toClasses}` : base)
    }
    for (const { binding, ownerId } of targeting ?? []) {
      take(binding, interactionStateKey(binding.interactionId, nodeId, scopeOf(ownerId)))
    }
    // a channel key carries NO scope, whoever declared the binding
    for (const { binding } of onChannel) {
      take(binding, interactionStateKey(binding.interactionId, channelTargetId(channel!)))
    }
    return parts.join(' ')
  }

  /**
   * Interaction classes for a master node rendered inside an instance:
   * every interaction in the component targeting this master node,
   * active when fired in THIS instance's scope.
   */
  function scopedClassesFor(
    masterId: string,
    componentRoot: ElementNode,
    scopeOf: ScopeOf,
    breakpointId: string | null = null,
    channel?: string,
  ): string {
    const seen = new Set<string>()
    const parts: string[] = []
    const take = (binding: InteractionBinding, key: string) => {
      if (!bindingActiveAt(binding, breakpointId)) return
      if (seen.has(binding.interactionId)) return
      seen.add(binding.interactionId)
      const animation = animationIndex.value.get(binding.interactionId)
      if (!animation) return
      const base = `transition-all ${animation.duration} ${animation.easing}`
      parts.push(fired.value.has(key) ? `${base} ${animation.toClasses}` : base)
    }
    // the per-master index, not a walk: this runs once per rendered element
    for (const { binding, ownerId } of masterInteractionsTargeting(masterId, componentRoot)) {
      take(binding, interactionStateKey(binding.interactionId, masterId, scopeOf(ownerId)))
    }
    // a master node may listen on a channel too — that is the whole point of
    // channels, and the key is the same unscoped one every trigger writes
    for (const { binding } of channelInteractionDrivers(channel)) {
      take(binding, interactionStateKey(binding.interactionId, channelTargetId(channel!)))
    }
    return parts.join(' ')
  }

  /** the state keys whose effect lands on this node — registered for
   * outside-click hit-testing so a click inside an open menu isn't "outside" */
  function targetStateKeys(nodeId: string, scopeOf: ScopeOf, channel?: string): string[] {
    const targeting = targetIndex.value.get(nodeId) ?? []
    return [
      ...new Set([
        ...targeting.map(({ binding, ownerId }) =>
          interactionStateKey(binding.interactionId, nodeId, scopeOf(ownerId)),
        ),
        ...channelInteractionDrivers(channel).map(({ binding }) =>
          interactionStateKey(binding.interactionId, channelTargetId(channel!)),
        ),
      ]),
    ]
  }

  /** targetStateKeys for a master node rendered inside a component instance */
  function scopedTargetStateKeys(
    masterId: string,
    componentRoot: ElementNode,
    scopeOf: ScopeOf,
    channel?: string,
  ): string[] {
    const keys = new Set<string>()
    for (const { binding, ownerId } of masterInteractionsTargeting(masterId, componentRoot)) {
      keys.add(interactionStateKey(binding.interactionId, masterId, scopeOf(ownerId)))
    }
    for (const { binding } of channelInteractionDrivers(channel)) {
      keys.add(interactionStateKey(binding.interactionId, channelTargetId(channel!)))
    }
    return [...keys]
  }

  /** the state key a binding drives, given the node that owns it */
  function bindingStateKey(
    binding: InteractionBinding,
    ownerId: string,
    scope?: string,
  ): string {
    const targetId = binding.targetId ?? ownerId
    // a channel is site-wide by definition: no instance, no entry. Dropped
    // HERE as well as in the renderers' scopeFor, so a caller that passes a
    // scope anyway still writes the key the listener reads.
    return interactionStateKey(
      binding.interactionId,
      targetId,
      isChannelTarget(targetId) ? undefined : scope,
    )
  }

  /** is any of these state keys currently on? Reactive — reads the shared
   *  `fired` set, so a watcher on it sees every open and close. */
  function isAnyFired(keys: string[]): boolean {
    return keys.some((key) => fired.value.has(key))
  }

  /** true when a binding's effect is currently on */
  function isBindingOn(binding: InteractionBinding, ownerId: string, scope?: string): boolean {
    return fired.value.has(bindingStateKey(binding, ownerId, scope))
  }

  /**
   * Apply a binding's effect.
   *
   * `on` forces a state (hover enter/leave, scroll position, input change);
   * omitting it honours the binding's `action` — 'on' / 'off' / 'toggle'
   * (default). Handles exclusive groups and dismissal registration.
   *
   * `instanceScope` is the component-instance part of the scope only: exclusive
   * groups must hold across a collection-list's repeats (one accordion open at a
   * time) while staying independent per component instance.
   *
   * NOTE: `binding.once` is deliberately NOT honoured here. Remembering a
   * dismissal across reloads would hide the element from the author, who still
   * has to select and style it. It applies on the published site only
   * (server/site-runtime.js).
   */
  function applyBinding(
    binding: InteractionBinding,
    ownerId: string,
    scope?: string,
    instanceScope?: string,
    on?: boolean,
  ) {
    const key = bindingStateKey(binding, ownerId, scope)
    const next = on ?? nextInteractionState(binding.action, fired.value.has(key))
    // options come from the EFFECT, not this one binding (see effectOptions)
    const options = effectOptions.value.get(binding.targetId ?? ownerId)

    if (options?.group) {
      // a group on a channel-targeting binding is unscoped too, so one group
      // can span a trigger on the page and a trigger inside a component
      const groupKey = interactionGroupKey(
        options.group,
        isChannelTarget(binding.targetId) ? undefined : instanceScope,
      )
      if (next) {
        const open = firedGroups.get(groupKey)
        if (open && open !== key) {
          openDismissals.delete(open)
          rawSet(open, false)
        }
        firedGroups.set(groupKey, key)
      } else if (firedGroups.get(groupKey) === key) {
        firedGroups.delete(groupKey)
      }
    }

    if (options?.closeOn.size) {
      if (next) {
        openDismissals.set(key, options.closeOn)
        installDismissListeners()
      } else {
        openDismissals.delete(key)
      }
    }

    rawSet(key, next)
  }

  /**
   * Register a rendered element as "inside" the given state keys, so an
   * outside-click dismissal can tell a click on the menu from a click off it.
   * Renderers call this for the keys they trigger AND the keys that target them.
   */
  function registerInteractionEl(keys: string[], el: HTMLElement) {
    for (const key of keys) {
      const set = dismissEls.get(key) ?? new Set<HTMLElement>()
      set.add(el)
      dismissEls.set(key, set)
    }
  }

  function unregisterInteractionEl(keys: string[], el: HTMLElement) {
    for (const key of keys) {
      const set = dismissEls.get(key)
      if (!set) continue
      set.delete(el)
      if (!set.size) dismissEls.delete(key)
    }
  }

  /** drop every fired state for an interaction (optionally one target only) —
   * used when a binding or a library entry goes away */
  function clearStateFor(interactionId: string, targetId?: string) {
    const prefix = targetId ? `${interactionId}:${targetId}` : `${interactionId}:`
    const stale = [...fired.value].filter((k) => k.startsWith(prefix))
    for (const key of stale) closeDismissable(key)
  }

  /** every binding whose effect lands on this node (see driversIndex) */
  function driversFor(nodeId: string): Driver[] {
    return driversIndex.value.get(nodeId) ?? []
  }

  /** assign the picked canvas element as the pending binding's target */
  function pickTarget(nodeId: string) {
    for (const binding of pendingPicks()) binding.targetId = nodeId
    pickingFor.value = null
  }

  // --- shared interaction library (project-level) + per-element bindings ---

  const library = computed(() => project.value.interactions)

  function animationFor(interactionId: string): Interaction | undefined {
    return animationIndex.value.get(interactionId)
  }

  /** every tree that can hold bindings (all pages + component masters) */
  function allTrees(): ElementNode[][] {
    return [
      ...project.value.pages.map((p) => p.elements),
      ...project.value.components.map((c) => [c.root]),
    ]
  }

  function createInteraction(): Interaction {
    const animation: Interaction = {
      id: uid(),
      name: `Interaction ${project.value.interactions.length + 1}`,
      toClasses: '',
      duration: 'duration-300',
      easing: 'ease-out',
    }
    project.value.interactions.push(animation)
    return animation
  }

  function updateInteraction(id: string, patch: Partial<Omit<Interaction, 'id'>>) {
    const animation = project.value.interactions.find((a) => a.id === id)
    if (animation) Object.assign(animation, patch)
  }

  /** number of element bindings referencing a saved interaction */
  function usageCount(interactionId: string): number {
    let count = 0
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        for (const b of node.interactions ?? []) if (b.interactionId === interactionId) count++
      })
    }
    return count
  }

  /** delete a saved interaction and un-apply it from every element */
  function deleteInteraction(interactionId: string) {
    project.value.interactions = project.value.interactions.filter((a) => a.id !== interactionId)
    clearStateFor(interactionId)
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        if (!node.interactions?.some((b) => b.interactionId === interactionId)) return
        node.interactions = node.interactions.filter((b) => b.interactionId !== interactionId)
      })
    }
  }

  /** apply a saved interaction to an element (default trigger hover, self target) */
  function applyTo(node: ElementNode, interactionId: string): InteractionBinding {
    node.interactions ??= []
    const binding: InteractionBinding = {
      id: uid(),
      interactionId,
      trigger: 'hover',
      targetId: null,
    }
    node.interactions.push(binding)
    return binding
  }

  function removeBinding(node: ElementNode, bindingId: string) {
    if (!node.interactions) return
    const binding = node.interactions.find((b) => b.id === bindingId)
    if (binding) clearStateFor(binding.interactionId, binding.targetId ?? node.id)
    cancelPickFor(bindingId)
    node.interactions = node.interactions.filter((b) => b.id !== bindingId)
  }

  return {
    fired,
    pickingFor,
    classesFor,
    scopedClassesFor,
    targetStateKeys,
    scopedTargetStateKeys,
    scopeRoots,
    bindingStateKey,
    isBindingOn,
    isAnyFired,
    applyBinding,
    registerInteractionEl,
    unregisterInteractionEl,
    clearStateFor,
    pendingPicks,
    driversIndex,
    driversFor,
    pickTarget,
    library,
    animationFor,
    createInteraction,
    updateInteraction,
    usageCount,
    deleteInteraction,
    applyTo,
    removeBinding,
  }
}
