import { computed, type ComputedRef } from 'vue'
import type { AnimationBinding, ElementNode, InteractionBinding } from '@/types/editor'
import { walkNodes } from '@/lib/tree'

/**
 * Which bindings, anywhere in a component master, land on each of its nodes.
 *
 * A node rendered inside an instance used to answer this by WALKING THE WHOLE
 * MASTER — three times (interaction classes, state keys, animations), through
 * the reactive proxy, once per rendered element. On a page holding a few
 * thousand instance elements that was the single largest cost of opening it:
 * seconds of `walkNodes` per render, most of it proxy overhead.
 *
 * One computed per master root instead, shared by every element that reads it
 * and rebuilt only when a binding or the structure changes. Keyed weakly by
 * the root object, so a master that goes away takes its index with it.
 */
/** a binding paired with the node it is DECLARED on — the owner decides the
 * entry part of the binding's scope (src/lib/shared/entryScope.js) */
export interface OwnedBinding<T> {
  binding: T
  ownerId: string
}

export interface MasterBindingIndex {
  interactions: Map<string, OwnedBinding<InteractionBinding>[]>
  animations: Map<string, OwnedBinding<AnimationBinding>[]>
}

const indexes = new WeakMap<ElementNode, ComputedRef<MasterBindingIndex>>()

const EMPTY: readonly never[] = []

export function masterBindingIndex(root: ElementNode): MasterBindingIndex {
  let index = indexes.get(root)
  if (!index) {
    index = computed<MasterBindingIndex>(() => {
      const interactions = new Map<string, OwnedBinding<InteractionBinding>[]>()
      const animations = new Map<string, OwnedBinding<AnimationBinding>[]>()
      walkNodes([root], (owner) => {
        for (const binding of owner.interactions ?? []) {
          const key = binding.targetId ?? owner.id
          const list = interactions.get(key) ?? []
          list.push({ binding, ownerId: owner.id })
          interactions.set(key, list)
        }
        for (const binding of owner.animations ?? []) {
          const key = binding.targetId ?? owner.id
          const list = animations.get(key) ?? []
          list.push({ binding, ownerId: owner.id })
          animations.set(key, list)
        }
      })
      return { interactions, animations }
    })
    indexes.set(root, index)
  }
  return index.value
}

/** interaction bindings in `root`'s master whose effect lands on `masterId` */
export function masterInteractionsTargeting(
  masterId: string,
  root: ElementNode,
): readonly OwnedBinding<InteractionBinding>[] {
  return masterBindingIndex(root).interactions.get(masterId) ?? EMPTY
}

/** animation bindings in `root`'s master whose animation moves `masterId` */
export function masterAnimationsTargeting(
  masterId: string,
  root: ElementNode,
): readonly OwnedBinding<AnimationBinding>[] {
  return masterBindingIndex(root).animations.get(masterId) ?? EMPTY
}
