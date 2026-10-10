import { computed } from 'vue'
import { useElement } from './useElement'
import { useAnimation } from './useAnimation'
import { useEffects, type EffectPair } from './useEffects'
import { useComponents } from './useComponents'
import { isDrivenState, useInteraction, type Driver } from './useInteraction'
import type { DrawerKind } from './useEffectsDrawer'
import {
  triggerAllows,
  triggerOrder,
  triggerSentence,
  type EffectKind,
} from '@/lib/effectTriggers'
import type { AnimationBinding, Effect, InteractionBinding } from '@/types/editor'

export interface StateRow {
  key: string
  drawerKind: DrawerKind
  drawerId: string
  name: string
  summary: string
  classDrivers: Driver[]
  driverOwnerIds: string[]
}

export interface ActionRow {
  key: string
  trigger: string
  sentence: string
  name: string
  pair: EffectPair
  ref: { kind: DrawerKind; id: string }
}

export function rowId(pair: EffectPair): string {
  return (pair.interaction ?? pair.animation)!.id
}

export function drawerRefOf(pair: EffectPair): { kind: DrawerKind; id: string } {
  if (pair.effect) return { kind: 'effect', id: pair.effect.id }
  if (pair.interaction) return { kind: 'interaction', id: pair.interaction.interactionId }
  return { kind: 'animation', id: pair.animation!.animationId }
}

export function useElementEffects() {
  const { isMultiSelect } = useElement()
  const interactions = useInteraction()
  const animations = useAnimation()
  const effects = useEffects()
  const { driversFor, animationFor } = interactions
  const { animDriversFor, animationFor: timelineFor } = animations
  const { pairsFor, effectForHalf, nameOf } = effects
  const { editTarget } = useComponents()

  const target = editTarget
  const canEdit = computed(() => !!target.value && !isMultiSelect.value)

  const elementLabel = computed(() => {
    const n = target.value
    if (!n) return ''
    return n.ref ? `#${n.ref}` : n.type
  })

  const states = computed<StateRow[]>(() => {
    const n = canEdit.value ? target.value : null
    if (!n) return []

    interface Group {
      drawerKind: DrawerKind
      drawerId: string
      name: string
      summary: string
      classDrivers: Driver[]
      drivers: { binding: { trigger: string }; ownerId: string }[]
      ownerIds: string[]
    }
    const groups = new Map<string, Group>()

    const add = (
      kind: EffectKind,
      halfId: string,
      driver: { binding: { trigger: string }; ownerId: string },
    ) => {
      const effect = effectForHalf(kind, halfId)
      const key = effect ? effect.id : `${kind}:${halfId}`
      const classEffect = kind === 'interaction' ? animationFor(halfId) : undefined
      const fallbackName =
        (kind === 'interaction' ? animationFor(halfId)?.name : timelineFor(halfId)?.name) ??
        'Missing effect'
      const group =
        groups.get(key) ??
        ({
          drawerKind: effect ? 'effect' : kind,
          drawerId: effect ? effect.id : halfId,
          name: effect?.name ?? fallbackName,
          summary: '',
          classDrivers: [],
          drivers: [],
          ownerIds: [],
        } satisfies Group)
      if (classEffect) group.summary = classEffect.toClasses?.trim() ?? ''
      if (kind === 'interaction') group.classDrivers.push(driver as Driver)
      group.drivers.push(driver)
      group.ownerIds.push(driver.ownerId)
      groups.set(key, group)
    }

    for (const driver of driversFor(n.id)) add('interaction', driver.binding.interactionId, driver)
    for (const driver of animDriversFor(n.id)) add('animation', driver.binding.animationId, driver)

    const out: StateRow[] = []
    for (const [key, group] of groups) {
      if (!isDrivenState(n.id, group.drivers)) continue
      out.push({
        key,
        drawerKind: group.drawerKind,
        drawerId: group.drawerId,
        name: group.name,
        summary: group.summary,
        classDrivers: group.classDrivers,
        driverOwnerIds: group.ownerIds,
      })
    }
    return out
  })

  const actions = computed<ActionRow[]>(() => {
    const n = canEdit.value ? target.value : null
    if (!n) return []
    return pairsFor(n, n.id)
      .map((pair) => {
        const trigger = (pair.interaction ?? pair.animation)!.trigger
        return {
          key: rowId(pair),
          trigger,
          sentence: triggerSentence(trigger),
          name: nameOf(pair),
          pair,
          ref: drawerRefOf(pair),
        }
      })
      .sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger))
  })

  function createActionFor(trigger: string): { effect: Effect; key: string } | null {
    const owner = canEdit.value ? target.value : null
    if (!owner) return null
    const classHalf = interactions.createInteraction()
    const effect = effects.wrap('interaction', classHalf.id, classHalf.name)
    effects.addHalf(effect, 'animation')
    const has = effects.halfIds(effect)
    let key = ''
    if (has.interactionId && triggerAllows(trigger, 'interaction')) {
      const binding = interactions.applyTo(owner, has.interactionId)
      binding.trigger = trigger as InteractionBinding['trigger']
      key = binding.id
    }
    if (has.animationId && triggerAllows(trigger, 'animation')) {
      const binding = animations.applyTo(owner, has.animationId)
      if (binding) {
        binding.trigger = trigger as AnimationBinding['trigger']
        if (!key) key = binding.id
      }
    }
    return { effect, key }
  }

  return { target, canEdit, elementLabel, states, actions, createActionFor }
}
