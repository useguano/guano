import { computed, type ComputedRef } from 'vue'
import type { AnimationBinding, ElementNode, InteractionBinding } from '@/types/editor'
import { walkNodes } from '@/lib/tree'

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

export function masterInteractionsTargeting(
  masterId: string,
  root: ElementNode,
): readonly OwnedBinding<InteractionBinding>[] {
  return masterBindingIndex(root).interactions.get(masterId) ?? EMPTY
}

export function masterAnimationsTargeting(
  masterId: string,
  root: ElementNode,
): readonly OwnedBinding<AnimationBinding>[] {
  return masterBindingIndex(root).animations.get(masterId) ?? EMPTY
}
