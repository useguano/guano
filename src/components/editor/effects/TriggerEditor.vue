<script setup lang="ts">
// The drawer's TRIGGER view: what the selected element does when one trigger
// fires, in one panel — WHERE on the left, WHAT on the right.
//
// ONE action per trigger. A click runs one effect; an author who wants more
// adds another trigger, not a second action — so there is no list and nothing
// to open. The Interactions panel names the element's triggers; adding one
// creates its action (a new effect) and lands here. The left column answers
// where the effect lands and how it is aimed (`ActionOptions`); the right is the
// effect itself, its classes and its motion (`EffectBody`), shared by every
// element using it. The header names the trigger and the effect, and holds the
// three verbs: Remove the action, Cancel, Apply.
//
// A trigger that already holds several actions — an agent's write, an older
// project — shows them all, stacked, so nothing is hidden; the UI just never
// adds a second one. Dismissal, exclusive groups and remembered dismissal are
// not edited here (agent-only for now).
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ActionOptions from '@/components/editor/interactions/ActionOptions.vue'
import EffectBody from '@/components/editor/effects/EffectBody.vue'
import EffectNameField from '@/components/editor/effects/EffectNameField.vue'
import { useElementEffects, rowId } from '@/composables/useElementEffects'
import { useEffects, type EffectPair } from '@/composables/useEffects'
import { useEffectsDrawer, type DrawerKind } from '@/composables/useEffectsDrawer'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { useElement } from '@/composables/useElement'
import { uiTrigger } from '@/lib/effectTriggers'

const props = defineProps<{ trigger: string }>()

const { target, canEdit, sections, createActionFor } = useElementEffects()
const effects = useEffects()
const interactions = useInteraction()
const animations = useAnimation()
const motion = useMotion()
const { highlightElement } = useElement()
const { fresh, effectCreated, keepEffect, closeDrawer } = useEffectsDrawer()

const ui = computed(() => uiTrigger(props.trigger))
const rows = computed(
  () => sections.value.find((s) => s.trigger === props.trigger)?.rows ?? [],
)
/** the effect the header names — the (one) action's */
const headEffect = computed(() => (rows.value[0] ? bodyOf(rows.value[0]) : null))

/** what the effect column shows for an action: the effect, or its lone half */
function bodyOf(pair: EffectPair): { kind: DrawerKind; id: string } {
  if (pair.effect) return { kind: 'effect', id: pair.effect.id }
  if (pair.interaction) return { kind: 'interaction', id: pair.interaction.interactionId }
  return { kind: 'animation', id: pair.animation!.animationId }
}

/** an emptied trigger gets its action back the same way a new one gets its first */
function addAction() {
  const effect = createActionFor(props.trigger)
  if (effect) effectCreated(effect.id)
}

/** take the action off this element — the effect stays in the library for the
 *  next one — and close: the trigger is gone from the panel with it */
function removeAction() {
  const owner = target.value
  if (!owner) return
  for (const pair of rows.value) {
    if (pair.animation) {
      motion.stop(pair.animation, pair.animation.targetId ?? owner.id)
      animations.removeBinding(owner, pair.animation.id)
    }
    if (pair.interaction) interactions.removeBinding(owner, pair.interaction.id)
  }
  highlightElement(null)
  closeDrawer()
}

/** Cancel on a brand-new effect discards it outright — the cascading delete
 *  also strips the binding, wherever it landed — and closes. On an effect the
 *  author has already kept, every edit is live, so it only closes. */
function cancel() {
  const effect = fresh.value ? effects.effectById(fresh.value) : null
  if (effect) effects.deleteEffect(effect)
  closeDrawer()
}

/** keep what is there and close */
function apply() {
  keepEffect()
  closeDrawer()
}
</script>

<template>
  <div data-trigger-editor class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- [icon] when · the effect's name · who uses it ……… Remove / Cancel / Apply -->
    <header class="flex h-9 shrink-0 items-center gap-2 border-b border-input px-3">
      <component v-if="ui" :is="ui.icon" class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="shrink-0 text-xs font-medium">{{ ui?.sentence ?? trigger }}</span>
      <EffectNameField v-if="headEffect" v-bind="headEffect" class="ml-1" />
      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        <ButtonUI
          v-if="rows.length"
          variant="ghost"
          size="xs"
          class="text-muted-foreground hover:!text-danger"
          @click="removeAction"
        >
          Remove
        </ButtonUI>
        <ButtonUI variant="outline" size="xs" @click="cancel">Cancel</ButtonUI>
        <ButtonUI variant="default" size="xs" @click="apply">Apply</ButtonUI>
      </div>
    </header>

    <p v-if="!canEdit" class="p-3 text-xs text-muted-foreground">
      Select a single element to manage what it does.
    </p>

    <!-- the action was removed: nothing runs here until one is made again -->
    <div v-else-if="!rows.length" class="flex items-center gap-3 p-3">
      <p class="text-xs text-muted-foreground">Nothing runs on this trigger.</p>
      <ButtonUI variant="outline" size="xs" :icon="Plus" @click="addAction">Effect</ButtonUI>
    </div>

    <div
      v-else
      class="custom-scrollbar grid min-h-0 flex-1 grid-cols-1 overflow-x-hidden overflow-y-auto xl:grid-cols-[17rem_minmax(0,1fr)]"
    >
      <!-- WHERE: the element it lands on, its direction, which screens -->
      <div class="flex flex-col border-b border-input pb-2 xl:border-r xl:border-b-0">
        <p class="flex h-7 items-center px-2.5 section-label">
          Where
        </p>
        <ActionOptions v-for="row in rows" :key="rowId(row)" :pair="row" :owner="target!" />
      </div>

      <!-- WHAT: the effect itself, shared by every element using it -->
      <div class="flex min-w-0 flex-col">
        <EffectBody v-for="row in rows" :key="rowId(row)" v-bind="bodyOf(row)" :name-row="false" />
      </div>
    </div>
  </div>
</template>
