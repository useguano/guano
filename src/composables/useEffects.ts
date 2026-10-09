import { computed } from 'vue'
import { walkNodes } from '@/lib/tree'
import { triggerAllows } from '@/lib/effectTriggers'
import { useProject } from './useProject'
import { useInteraction } from './useInteraction'
import { useAnimation } from './useAnimation'
import type {
  AnimationBinding,
  Effect,
  ElementNode,
  InteractionBinding,
} from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

export interface EffectPair {
  effect?: Effect
  interaction?: InteractionBinding
  animation?: AnimationBinding
}

export interface LibraryItem {
  id: string
  kind: 'effect' | 'interaction' | 'animation'
  name: string
}

export function useEffects() {
  const { project } = useProject()
  const interactions = useInteraction()
  const animations = useAnimation()

  const effects = computed<Effect[]>(() => project.value.effects ?? [])

  function effectById(id: string): Effect | undefined {
    return effects.value.find((e) => e.id === id)
  }

  function effectForHalf(kind: 'interaction' | 'animation', halfId: string): Effect | undefined {
    return effects.value.find((e) =>
      kind === 'interaction' ? e.interactionId === halfId : e.animationId === halfId,
    )
  }

  const libraryItems = computed<LibraryItem[]>(() => {
    const claimedInteractions = new Set<string>()
    const claimedAnimations = new Set<string>()
    const out: LibraryItem[] = []
    for (const effect of effects.value) {
      if (effect.interactionId) claimedInteractions.add(effect.interactionId)
      if (effect.animationId) claimedAnimations.add(effect.animationId)
      out.push({ id: effect.id, kind: 'effect', name: effect.name })
    }
    for (const item of interactions.library.value) {
      if (!claimedInteractions.has(item.id)) {
        out.push({ id: item.id, kind: 'interaction', name: item.name })
      }
    }
    for (const item of animations.library.value) {
      if (!claimedAnimations.has(item.id)) {
        out.push({ id: item.id, kind: 'animation', name: item.name })
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  })

  function halfIds(effect: Effect): { interactionId?: string; animationId?: string } {
    return {
      ...(effect.interactionId && interactions.animationFor(effect.interactionId)
        ? { interactionId: effect.interactionId }
        : {}),
      ...(effect.animationId && animations.animationFor(effect.animationId)
        ? { animationId: effect.animationId }
        : {}),
    }
  }

  function usageCount(effect: Effect): number {
    let n = 0
    if (effect.interactionId) n += interactions.usageCount(effect.interactionId)
    if (effect.animationId) n += animations.usageCount(effect.animationId)
    return n
  }

  function list(): Effect[] {
    project.value.effects ??= []
    return project.value.effects
  }

  function wrap(kind: 'interaction' | 'animation', halfId: string, name: string): Effect {
    const existing = effectForHalf(kind, halfId)
    if (existing) return existing
    const effect: Effect = {
      id: uid(),
      name,
      ...(kind === 'interaction' ? { interactionId: halfId } : { animationId: halfId }),
    }
    list().push(effect)
    return effect
  }

  function allTrees(): ElementNode[][] {
    return [
      ...project.value.pages.map((p) => p.elements),
      ...(project.value.components ?? []).map((c) => [c.root]),
    ]
  }

  function spreadHalf(from: 'interaction' | 'animation', fromId: string, toId: string) {
    for (const tree of allTrees()) {
      walkNodes(tree, (node) => {
        const sources =
          from === 'interaction'
            ? (node.interactions ?? []).filter((b) => b.interactionId === fromId)
            : (node.animations ?? []).filter((b) => b.animationId === fromId)
        for (const source of sources) {
          if (!triggerAllows(source.trigger, from === 'interaction' ? 'animation' : 'interaction')) {
            continue
          }
          const made =
            from === 'interaction'
              ? animations.applyTo(node, toId)
              : interactions.applyTo(node, toId)
          if (!made) continue
          made.trigger = source.trigger as typeof made.trigger
          made.targetId = source.targetId
          if (source.action) made.action = source.action
          if (source.breakpoints) made.breakpoints = [...source.breakpoints]
        }
      })
    }
  }

  function addHalf(effect: Effect, kind: 'interaction' | 'animation') {
    const has = halfIds(effect)
    if (kind === 'interaction') {
      if (has.interactionId) return
      const half = interactions.createInteraction()
      half.name = effect.name
      effect.interactionId = half.id
      if (has.animationId) spreadHalf('animation', has.animationId, half.id)
    } else {
      if (has.animationId) return
      const half = animations.createAnimation()
      half.name = effect.name
      effect.animationId = half.id
      if (has.interactionId) spreadHalf('interaction', has.interactionId, half.id)
    }
  }

  function rename(effect: Effect, name: string) {
    effect.name = name
    if (effect.interactionId) interactions.updateInteraction(effect.interactionId, { name })
    if (effect.animationId) animations.updateAnimation(effect.animationId, { name })
  }

  function removeEffect(id: string) {
    const kept = effects.value.filter((e) => e.id !== id)
    if (kept.length) project.value.effects = kept
    else delete project.value.effects
  }

  function deleteEffect(effect: Effect) {
    if (effect.interactionId) interactions.deleteInteraction(effect.interactionId)
    if (effect.animationId) animations.deleteAnimation(effect.animationId)
    removeEffect(effect.id)
  }

  function pairsFor(node: ElementNode, ownerId: string): EffectPair[] {
    const out: EffectPair[] = []
    const takenAnimations = new Set<string>()
    const animationBindings = node.animations ?? []

    for (const interaction of node.interactions ?? []) {
      const effect = effectForHalf('interaction', interaction.interactionId)
      const mate =
        effect?.animationId &&
        animationBindings.find(
          (a) =>
            !takenAnimations.has(a.id) &&
            a.animationId === effect.animationId &&
            a.trigger === interaction.trigger &&
            (a.targetId ?? ownerId) === (interaction.targetId ?? ownerId),
        )
      if (mate) takenAnimations.add(mate.id)
      out.push({ effect, interaction, animation: mate || undefined })
    }

    for (const animation of animationBindings) {
      if (takenAnimations.has(animation.id)) continue
      out.push({ effect: effectForHalf('animation', animation.animationId), animation })
    }
    return out
  }

  function nameOf(pair: EffectPair): string {
    if (pair.effect) return pair.effect.name
    if (pair.interaction) {
      return interactions.animationFor(pair.interaction.interactionId)?.name ?? 'Missing effect'
    }
    if (pair.animation) {
      return animations.animationFor(pair.animation.animationId)?.name ?? 'Missing effect'
    }
    return 'Missing effect'
  }

  return {
    effects,
    effectById,
    effectForHalf,
    halfIds,
    libraryItems,
    usageCount,
    wrap,

    addHalf,
    rename,
    removeEffect,
    deleteEffect,
    pairsFor,
    nameOf,
  }
}
