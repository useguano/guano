import { computed } from 'vue'
import { usePage } from './usePage'
import { useProject } from './useProject'
import { cancelPickFor } from './useInteraction'
import { walkNodes } from '@/lib/tree'
import { masterAnimationsTargeting, type OwnedBinding } from './useMasterBindings'
import { countTargetError, validateAnimation } from '@/lib/motion'
import { isLeafElement } from '@/lib/elements'
import type { Animation, AnimationBinding, ElementNode } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

const { activePage } = usePage()
const { project } = useProject()

const animationIndex = computed(() => {
  const index = new Map<string, Animation>()
  for (const animation of project.value.animations ?? []) index.set(animation.id, animation)
  return index
})

const allBindings = computed(() => {
  const list: { owner: ElementNode; binding: AnimationBinding }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.animations ?? []) list.push({ owner: node, binding })
  })
  return list
})

const animTargetIndex = computed(() => {
  const index = new Map<string, OwnedBinding<AnimationBinding>[]>()
  for (const { owner, binding } of allBindings.value) {
    const key = binding.targetId ?? owner.id
    const list = index.get(key) ?? []
    list.push({ binding, ownerId: owner.id })
    index.set(key, list)
  }
  return index
})

const animDriversIndex = computed(() => {
  const index = new Map<string, OwnedBinding<AnimationBinding>[]>()
  const collect = (owner: ElementNode) => {
    for (const binding of owner.animations ?? []) {
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

export function animBindingActiveAt(
  binding: AnimationBinding,
  breakpointId: string | null,
): boolean {
  if (!binding.breakpoints || breakpointId === null) return true
  return binding.breakpoints.includes(breakpointId)
}

export function scopedAnimBindings(
  masterId: string,
  componentRoot: ElementNode,
): OwnedBinding<AnimationBinding>[] {
  return [...masterAnimationsTargeting(masterId, componentRoot)]
}

export function useAnimation() {
  const library = computed(() => project.value.animations ?? [])

  const animationFor = (id: string) => animationIndex.value.get(id)

  function allTrees(): ElementNode[][] {
    return [
      ...project.value.pages.map((p) => p.elements),
      ...(project.value.components ?? []).map((c) => [c.root]),
    ]
  }

  function addAnimation(animation: Animation): Animation {
    project.value.animations ??= []
    project.value.animations.push(animation)
    return animation
  }

  function createAnimation(): Animation {
    return addAnimation({
      id: uid(),
      name: `Animation ${library.value.length + 1}`,
      steps: [
        {
          id: uid(),
          tracks: [{ prop: 'opacity', from: 0, to: 1 }],
          duration: 600,
          easing: 'ease-out',
        },
      ],
    })
  }

  function updateAnimation(id: string, patch: Partial<Animation>) {
    const animation = animationFor(id)
    if (animation) Object.assign(animation, patch)
  }

  function usageCount(animationId: string): number {
    let n = 0
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        n += (node.animations ?? []).filter((b) => b.animationId === animationId).length
      })
    }
    return n
  }

  function deleteAnimation(animationId: string) {
    project.value.animations = library.value.filter((a) => a.id !== animationId)
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        if (!node.animations?.length) return
        const kept = node.animations.filter((b) => b.animationId !== animationId)
        if (kept.length) node.animations = kept
        else delete node.animations
      })
    }
    const transitions = project.value.settings?.motion?.transitions
    if (transitions) {
      if (transitions.exitAnimationId === animationId) transitions.exitAnimationId = undefined
      if (transitions.enterAnimationId === animationId) transitions.enterAnimationId = undefined
    }
  }

  function countShape(node: ElementNode) {
    return {
      type: node.type,
      isLeaf: isLeafElement(node.type),
      isBound: !!node.arg,
      text: typeof node.content === 'string' ? node.content : '',
      locale: project.value.defaultLocale || undefined,
    }
  }

  function applyTo(node: ElementNode, animationId: string): AnimationBinding | null {
    const timeline = animationIndex.value.get(animationId)
    if (timeline && countTargetError(timeline, countShape(node))) {
      return null
    }
    node.animations ??= []
    const binding: AnimationBinding = {
      id: uid(),
      animationId,
      trigger: 'appear',
      targetId: null,
    }
    node.animations.push(binding)
    return binding
  }

  function removeBinding(node: ElementNode, bindingId: string) {
    cancelPickFor(bindingId)
    const kept = (node.animations ?? []).filter((b) => b.id !== bindingId)
    if (kept.length) node.animations = kept
    else delete node.animations
  }

  function toggleBreakpoint(binding: AnimationBinding, breakpointId: string, allIds: string[]) {
    const on = new Set(binding.breakpoints ?? allIds)
    if (on.has(breakpointId)) {
      if (on.size <= 1) return
      on.delete(breakpointId)
    } else {
      on.add(breakpointId)
    }
    binding.breakpoints = allIds.every((id) => on.has(id)) ? undefined : allIds.filter((id) => on.has(id))
  }

  function animationError(
    animation: Animation,

    target?: ElementNode | null,
  ): string | null {
    const result = validateAnimation(animation)
    if (!result.ok) return result.error
    return target ? countTargetError(animation, countShape(target)) : null
  }

  function animDriversFor(nodeId: string): OwnedBinding<AnimationBinding>[] {
    return animDriversIndex.value.get(nodeId) ?? []
  }

  return {
    library,
    animationFor,
    animTargetIndex,
    animDriversIndex,
    animDriversFor,
    createAnimation,
    updateAnimation,
    deleteAnimation,
    usageCount,
    applyTo,
    removeBinding,
    toggleBreakpoint,
    animationError,
  }
}
