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

/**
 * The author's unit: ONE effect, which may be a class change, a timeline, or
 * both.
 *
 * Why both. A panel that slides in needs a class change AND a tween, and not
 * because anyone wants two things: `hidden` → `flex` cannot be tweened (the
 * first frame after a display change does not animate), and a slide cannot be
 * expressed as a class swap without fighting the cascade. The split is ours, not
 * the author's, so the library names the pair and the panel draws it as one row.
 *
 * What is STORED is only the name and the two ids (`project.effects`). The
 * halves stay in `project.interactions` and `project.animations`, and a node
 * still carries two ordinary bindings — so the exporter, both published
 * runtimes, the merge and every MCP tool are untouched by this file.
 *
 * A pair on an element is therefore RECOGNISED rather than recorded: two
 * bindings, same node, same trigger, same resolved target, holding the two
 * halves of one Effect. That is what keeps the two from drifting — there is no
 * link to maintain — and it means an agent writing the halves separately gets
 * the folded row for free.
 */

export interface EffectPair {
  /** the wrapper, when these bindings are two halves of one */
  effect?: Effect
  interaction?: InteractionBinding
  animation?: AnimationBinding
}

/** one row in the drawer's library: a named effect, or a bare half that no
 *  effect has claimed yet */
export interface LibraryItem {
  /** the id to select the drawer on */
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

  /** the effect that claims this half, if any */
  function effectForHalf(kind: 'interaction' | 'animation', halfId: string): Effect | undefined {
    return effects.value.find((e) =>
      kind === 'interaction' ? e.interactionId === halfId : e.animationId === halfId,
    )
  }

  /** what the drawer's library lists: every named effect, plus every half no
   *  effect has claimed — so nothing is ever hidden by not being wrapped */
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

  /**
   * The halves an effect actually HAS. A dangling id — its library entry deleted
   * by an agent, or by any tool that does not know about effects — counts as
   * none, so the drawer offers to make that half again instead of drawing an
   * empty section with a dead Remove button.
   */
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

  /** every element binding that uses either half, for the usage count */
  function usageCount(effect: Effect): number {
    let n = 0
    if (effect.interactionId) n += interactions.usageCount(effect.interactionId)
    if (effect.animationId) n += animations.usageCount(effect.animationId)
    return n
  }

  // --- making and unmaking ---

  function list(): Effect[] {
    project.value.effects ??= []
    return project.value.effects
  }

  /** wraps an existing half so it can gain the other one */
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

  /** every tree a binding can live in — pages and component masters */
  function allTrees(): ElementNode[][] {
    return [
      ...project.value.pages.map((p) => p.elements),
      ...(project.value.components ?? []).map((c) => [c.root]),
    ]
  }

  /**
   * An effect that gains a half gains it WHEREVER it is already used, with the
   * same when and where.
   *
   * Without this, adding motion to an effect already on twelve elements would
   * move none of them and nothing would say so — the silent no-op this project
   * refuses everywhere else. A trigger that cannot run the new engine is skipped
   * (a tween has nothing to do on `scrolled`), which the panel shows by leaving
   * that row a single half.
   */
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
          // a timeline the node cannot carry (a `count` on a container) binds
          // nothing rather than landing a binding that writes nowhere
          if (!made) continue
          made.trigger = source.trigger as typeof made.trigger
          made.targetId = source.targetId
          if (source.action) made.action = source.action
          if (source.breakpoints) made.breakpoints = [...source.breakpoints]
        }
      })
    }
  }

  /** gives an effect the half it is missing, created empty and ready to edit */
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

  /** the name is the effect's; the halves follow it so the two libraries read
   *  the same way from anywhere that still shows them */
  function rename(effect: Effect, name: string) {
    effect.name = name
    if (effect.interactionId) interactions.updateInteraction(effect.interactionId, { name })
    if (effect.animationId) animations.updateAnimation(effect.animationId, { name })
  }

  /** forgets the wrapper only — the halves and their bindings stay */
  function removeEffect(id: string) {
    const kept = effects.value.filter((e) => e.id !== id)
    if (kept.length) project.value.effects = kept
    else delete project.value.effects // keep an untouched project byte-identical
  }

  /** deletes the effect AND both halves, un-applying them everywhere */
  function deleteEffect(effect: Effect) {
    if (effect.interactionId) interactions.deleteInteraction(effect.interactionId)
    if (effect.animationId) animations.deleteAnimation(effect.animationId)
    removeEffect(effect.id)
  }

  // --- recognising a pair on an element ---

  /**
   * Groups a node's bindings into rows: each pair of halves that belong to one
   * Effect and agree on when and where becomes a single row, and everything
   * else stays on its own.
   *
   * `ownerId` resolves a `null` target, so two bindings that both mean "this
   * element" are seen to agree.
   */
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

  /** the name a row leads with: the effect's, or the lone half's */
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
