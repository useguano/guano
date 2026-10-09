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

const fired = ref(new Set<string>())

const firedGroups = new Map<string, string>()

const openDismissals = new Map<string, Set<string>>()

const dismissEls = new Map<string, Set<HTMLElement>>()

type Pickable = InteractionBinding | AnimationBinding
const pickingFor = ref<Pickable | Pickable[] | null>(null)

function pendingPicks(): Pickable[] {
  const pending = pickingFor.value
  if (!pending) return []
  return Array.isArray(pending) ? pending : [pending]
}

export function cancelPickFor(bindingId: string) {
  if (pendingPicks().some((b) => b.id === bindingId)) pickingFor.value = null
}

const { activePage } = usePage()
const { project } = useProject()

const animationIndex = computed(() => {
  const index = new Map<string, Interaction>()
  for (const animation of project.value.interactions ?? []) index.set(animation.id, animation)
  return index
})

const all = computed(() => {
  const list: { owner: ElementNode; binding: InteractionBinding }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.interactions ?? []) list.push({ owner: node, binding })
  })
  return list
})

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

const channelIndex = computed(() => buildChannelIndex(project.value))

export function channelInteractionDrivers(channel: string | undefined): Driver[] {
  if (!channel) return []
  return (channelIndex.value.get(channel)?.interactions ?? []) as Driver[]
}

export function channelAnimationDrivers(channel: string | undefined): AnimDriver[] {
  if (!channel) return []
  return ((channelIndex.value.get(channel)?.animations ?? []) as AnimDriver[]).filter(
    (d) => d.binding.trigger === 'click',
  )
}

const scopeRoots = computed(() =>
  buildScopeRoots([
    { tree: activePage.value.elements, root: null },
    ...(project.value.components ?? []).map((c) => ({ tree: [c.root], root: null })),
  ]),
)

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

export type Driver = { binding: InteractionBinding; ownerId: string }
export type AnimDriver = { binding: AnimationBinding; ownerId: string }

export function isDrivenState(
  targetId: string,
  drivers: { binding: { trigger: string }; ownerId: string }[],
): boolean {
  return drivers.some((d) => d.binding.trigger === 'click' || d.ownerId !== targetId)
}

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

export type ScopeOf = (ownerId: string) => string | undefined

export function bindingActiveAt(binding: InteractionBinding, breakpointId: string | null): boolean {
  if (!binding.breakpoints || breakpointId === null) return true
  return binding.breakpoints.includes(breakpointId)
}

function rawSet(key: string, on: boolean) {
  if (on === fired.value.has(key)) return
  const next = new Set(fired.value)
  if (on) next.add(key)
  else next.delete(key)
  fired.value = next
}

let dismissListening = false

function elementsFor(key: string): HTMLElement[] {
  return [...(dismissEls.get(key) ?? [])]
}

function closeDismissable(key: string) {
  openDismissals.delete(key)
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
    for (const { binding } of onChannel) {
      take(binding, interactionStateKey(binding.interactionId, channelTargetId(channel!)))
    }
    return parts.join(' ')
  }

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
    for (const { binding, ownerId } of masterInteractionsTargeting(masterId, componentRoot)) {
      take(binding, interactionStateKey(binding.interactionId, masterId, scopeOf(ownerId)))
    }
    for (const { binding } of channelInteractionDrivers(channel)) {
      take(binding, interactionStateKey(binding.interactionId, channelTargetId(channel!)))
    }
    return parts.join(' ')
  }

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

  function bindingStateKey(
    binding: InteractionBinding,
    ownerId: string,
    scope?: string,
  ): string {
    const targetId = binding.targetId ?? ownerId
    return interactionStateKey(
      binding.interactionId,
      targetId,
      isChannelTarget(targetId) ? undefined : scope,
    )
  }

  function isAnyFired(keys: string[]): boolean {
    return keys.some((key) => fired.value.has(key))
  }

  function isBindingOn(binding: InteractionBinding, ownerId: string, scope?: string): boolean {
    return fired.value.has(bindingStateKey(binding, ownerId, scope))
  }

  function applyBinding(
    binding: InteractionBinding,
    ownerId: string,
    scope?: string,
    instanceScope?: string,
    on?: boolean,
  ) {
    const key = bindingStateKey(binding, ownerId, scope)
    const next = on ?? nextInteractionState(binding.action, fired.value.has(key))
    const options = effectOptions.value.get(binding.targetId ?? ownerId)

    if (options?.group) {
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

  function clearStateFor(interactionId: string, targetId?: string) {
    const prefix = targetId ? `${interactionId}:${targetId}` : `${interactionId}:`
    const stale = [...fired.value].filter((k) => k.startsWith(prefix))
    for (const key of stale) closeDismissable(key)
  }

  function driversFor(nodeId: string): Driver[] {
    return driversIndex.value.get(nodeId) ?? []
  }

  function pickTarget(nodeId: string) {
    for (const binding of pendingPicks()) binding.targetId = nodeId
    pickingFor.value = null
  }

  const library = computed(() => project.value.interactions)

  function animationFor(interactionId: string): Interaction | undefined {
    return animationIndex.value.get(interactionId)
  }

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

  function usageCount(interactionId: string): number {
    let count = 0
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        for (const b of node.interactions ?? []) if (b.interactionId === interactionId) count++
      })
    }
    return count
  }

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
