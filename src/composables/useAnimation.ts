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

// The animation library + per-element bindings — the tween counterpart of
// useInteraction (class toggling). Same split: the timeline is shared in
// project.animations, the trigger/target is per-binding on the node.
//
// Like useInteraction, the derived indexes live at MODULE scope — one shared
// computed each — so N renderer nodes don't each build a tree-walking computed.
const { activePage } = usePage()
const { project } = useProject()
// the target picker is shared by both motion systems and lives in useInteraction
// (one-way edge: useInteraction takes only the AnimationBinding *type* from here)

/** animation id → the saved timeline */
const animationIndex = computed(() => {
  const index = new Map<string, Animation>()
  for (const animation of project.value.animations ?? []) index.set(animation.id, animation)
  return index
})

/** every animation binding on the page, paired with the node that triggers it */
const allBindings = computed(() => {
  const list: { owner: ElementNode; binding: AnimationBinding }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.animations ?? []) list.push({ owner: node, binding })
  })
  return list
})

/** node id → bindings whose animation moves that node */
const animTargetIndex = computed(() => {
  const index = new Map<string, OwnedBinding<AnimationBinding>[]>()
  for (const { owner, binding } of allBindings.value) {
    const key = binding.targetId ?? owner.id
    const list = index.get(key) ?? []
    // the owner travels with the binding: it decides the entry part of the
    // binding's scope (src/lib/shared/entryScope.js)
    list.push({ binding, ownerId: owner.id })
    index.set(key, list)
  }
  return index
})

/**
 * Target node id → every animation binding whose timeline MOVES it, paired with
 * the node that declares it. The tween half of the panel's States block: a
 * click play is shared per (animation, target), so an open button and a close
 * button both show up here as drivers of one state.
 *
 * Built over the active page AND every component master, exactly like
 * useInteraction's driversIndex, and read only by the panel — never per
 * rendered element, which uses animTargetIndex / masterAnimationsTargeting.
 */
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

/** whether a binding plays at the breakpoint being rendered (see
 * useInteraction.bindingActiveAt — same contract) */
export function animBindingActiveAt(
  binding: AnimationBinding,
  breakpointId: string | null,
): boolean {
  if (!binding.breakpoints || breakpointId === null) return true
  return binding.breakpoints.includes(breakpointId)
}

/** bindings inside a component master whose animation moves `masterId` */
export function scopedAnimBindings(
  masterId: string,
  componentRoot: ElementNode,
): OwnedBinding<AnimationBinding>[] {
  // the shared per-master index — a walk here ran once per rendered element
  return [...masterAnimationsTargeting(masterId, componentRoot)]
}

export function useAnimation() {
  const library = computed(() => project.value.animations ?? [])

  const animationFor = (id: string) => animationIndex.value.get(id)

  /** every tree a binding can live in — pages and component masters */
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

  /** how many elements play this animation, across every page and master */
  function usageCount(animationId: string): number {
    let n = 0
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        n += (node.animations ?? []).filter((b) => b.animationId === animationId).length
      })
    }
    return n
  }

  /** removes the library entry AND every binding referencing it */
  function deleteAnimation(animationId: string) {
    project.value.animations = library.value.filter((a) => a.id !== animationId)
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        if (!node.animations?.length) return
        const kept = node.animations.filter((b) => b.animationId !== animationId)
        if (kept.length) node.animations = kept
        else delete node.animations // keep untouched nodes byte-identical
      })
    }
    // a page transition can name an animation too, and it is not a binding on
    // any node — so the walk above would leave it pointing at a deleted id
    const transitions = project.value.settings?.motion?.transitions
    if (transitions) {
      if (transitions.exitAnimationId === animationId) transitions.exitAnimationId = undefined
      if (transitions.enterAnimationId === animationId) transitions.enterAnimationId = undefined
    }
  }

  /**
   * The element a timeline MOVES, as countTargetError wants it. `text` is the
   * node's OWN content — a `count` ends on the number the element says, so the
   * track's `to`/`format` have to read it back. Left empty when the node
   * inherits its text from a master (nothing of its own to disagree with), and
   * compared in the project's DEFAULT locale, which is the one the base content
   * is written in.
   */
  function countShape(node: ElementNode) {
    return {
      type: node.type,
      isLeaf: isLeafElement(node.type),
      isBound: !!node.arg,
      text: typeof node.content === 'string' ? node.content : '',
      locale: project.value.defaultLocale || undefined,
    }
  }

  /** binds an animation to a node; appear is the sane default trigger.
   *  Returns null when the timeline cannot land here — a `count` track writes
   *  the element's TEXT, so a container has nothing for it to write into. */
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
    // a pick in flight for this binding would land its targetId on a binding
    // that no longer exists (useInteraction.removeBinding does the same)
    cancelPickFor(bindingId)
    const kept = (node.animations ?? []).filter((b) => b.id !== bindingId)
    if (kept.length) node.animations = kept
    else delete node.animations
  }

  /** canonicalizes to `undefined` when every breakpoint is on, so an untouched
   * binding stays byte-identical for merge signatures */
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

  /** guards a library edit before it reaches the canvas/export */
  function animationError(
    animation: Animation,
    /** the element the timeline MOVES — a `count` track writes its text, so
     *  it only lands on a leaf that carries words and is not field-bound */
    target?: ElementNode | null,
  ): string | null {
    const result = validateAnimation(animation)
    if (!result.ok) return result.error
    return target ? countTargetError(animation, countShape(target)) : null
  }

  /** every binding whose timeline lands on this node (see animDriversIndex) */
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
