import { computed } from 'vue'
import { useElement } from './useElement'
import { useAnimation } from './useAnimation'
import { useEffects, type EffectPair } from './useEffects'
import { useComponents } from './useComponents'
import { isDrivenState, useInteraction, type Driver } from './useInteraction'
import type { DrawerKind } from './useEffectsDrawer'
import {
  UI_TRIGGERS,
  triggerAllows,
  triggerOrder,
  triggerSentence,
  type EffectKind,
} from '@/lib/effectTriggers'
import type { AnimationBinding, Effect, InteractionBinding } from '@/types/editor'

// What the SELECTED element does, read the way the UI shows it: its STATES (the
// effects some trigger puts it into) and its ACTIONS grouped by trigger.
//
// Two surfaces read this and must agree — the Interactions panel, which only
// lists the element's triggers, and the effects drawer's trigger view, which is
// where the rows live — so it is derived once here rather than in either.
//
// Inside a component instance the element is the shared master (`editTarget`):
// effects land there, so that is what both surfaces are about.

/** one card per effect landing on this element — a state worth surfacing */
export interface StateRow {
  key: string
  /** what "Edit effect" opens the drawer on */
  drawerKind: DrawerKind
  drawerId: string
  name: string
  summary: string
  classDrivers: Driver[]
  driverOwnerIds: string[]
}

export interface TriggerSection {
  trigger: string
  sentence: string
  rows: EffectPair[]
}

/** the id a row is keyed and opened by — its first half's binding id */
export function rowId(pair: EffectPair): string {
  return (pair.interaction ?? pair.animation)!.id
}

export function useElementEffects() {
  const { isMultiSelect } = useElement()
  const interactions = useInteraction()
  const animations = useAnimation()
  const effects = useEffects()
  const { driversFor, animationFor } = interactions
  const { animDriversFor, animationFor: timelineFor } = animations
  const { pairsFor, effectForHalf } = effects
  const { editTarget } = useComponents()

  const target = editTarget
  const canEdit = computed(() => !!target.value && !isMultiSelect.value)

  const elementLabel = computed(() => {
    const n = target.value
    if (!n) return ''
    return n.ref ? `#${n.ref}` : n.type
  })

  /**
   * One card per effect landing on this element — grouped by EFFECT, so a mixed
   * one is a single state wearing both engines rather than two cards saying half
   * the truth each.
   *
   * A card is drawn only when it is a state worth surfacing: driven by a CLICK
   * (the discrete gesture that has a direction, a dismissal and a group) or
   * driven by some OTHER element. A symmetric effect on itself is just a row.
   */
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
    // a click play is keyed per (animation, target) too, so a timeline several
    // triggers share is a state in exactly the same sense
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

  /**
   * One row per ACTION, not per binding: an effect wearing both engines holds
   * two bindings and must read as one thing (useEffects.pairsFor recognises the
   * pair). Only triggers with at least one action — an empty one is the drawer's
   * `trigger`, which each surface adds as it sees fit.
   */
  const sections = computed<TriggerSection[]>(() => {
    const n = canEdit.value ? target.value : null
    if (!n) return []
    const byTrigger = new Map<string, EffectPair[]>()
    for (const pair of pairsFor(n, n.id)) {
      const trigger = (pair.interaction ?? pair.animation)!.trigger
      const list = byTrigger.get(trigger) ?? []
      list.push(pair)
      byTrigger.set(trigger, list)
    }
    return [...byTrigger.entries()]
      .map(([trigger, rows]) => ({ trigger, rows, sentence: triggerSentence(trigger) }))
      .sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger))
  })

  /** triggers not already on this element — a second empty "On click" would be a bug */
  const availableTriggers = computed(() =>
    UI_TRIGGERS.filter((t) => !sections.value.some((s) => s.trigger === t.key)),
  )

  /**
   * Give a trigger its action: a NEW effect — one thing, both halves, the
   * classes it wears and the motion it runs — bound to the element under this
   * trigger, every half the trigger can run. Adding a trigger IS this: the
   * author never picks between engines, presets or saved effects first; the
   * effect is there to edit the moment the trigger exists.
   */
  function createActionFor(trigger: string): Effect | null {
    const owner = canEdit.value ? target.value : null
    if (!owner) return null
    const classHalf = interactions.createInteraction()
    const effect = effects.wrap('interaction', classHalf.id, classHalf.name)
    effects.addHalf(effect, 'animation')
    const has = effects.halfIds(effect)
    if (has.interactionId && triggerAllows(trigger, 'interaction')) {
      const binding = interactions.applyTo(owner, has.interactionId)
      binding.trigger = trigger as InteractionBinding['trigger']
    }
    if (has.animationId && triggerAllows(trigger, 'animation')) {
      const binding = animations.applyTo(owner, has.animationId)
      // null when the timeline cannot land here (a `count` on a container)
      if (binding) binding.trigger = trigger as AnimationBinding['trigger']
    }
    return effect
  }

  return { target, canEdit, elementLabel, states, sections, availableTriggers, createActionFor }
}
