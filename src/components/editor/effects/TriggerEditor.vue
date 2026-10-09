<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Play, Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import ActionOptions from '@/components/editor/interactions/ActionOptions.vue'
import EffectBody from '@/components/editor/effects/EffectBody.vue'
import { useElementEffects, drawerRefOf, rowId } from '@/composables/useElementEffects'
import { useEffects } from '@/composables/useEffects'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { useElement } from '@/composables/useElement'
import { triggerAllows, type EffectKind } from '@/lib/effectTriggers'

const props = defineProps<{ trigger: string }>()

const { target, canEdit, sections, createActionFor } = useElementEffects()
const effects = useEffects()
const interactions = useInteraction()
const animations = useAnimation()
const motion = useMotion()
const { highlightElement } = useElement()
const { fresh, effectCreated, keepEffect, closeDrawer } = useEffectsDrawer()

const rows = computed(
  () => sections.value.find((s) => s.trigger === props.trigger)?.rows ?? [],
)
const headEffect = computed(() => (rows.value[0] ? drawerRefOf(rows.value[0]) : null))

const TYPES: { label: string; value: EffectKind }[] = [
  { label: 'Classes', value: 'interaction' },
  { label: 'Motion', value: 'animation' },
]
const typeOptions = computed(() => TYPES.filter((t) => triggerAllows(props.trigger, t.value)))

const chosenType = ref<EffectKind | null>(null)
watch(
  () => props.trigger,
  () => (chosenType.value = null),
)

const wrapped = computed(() =>
  headEffect.value?.kind === 'effect' ? (effects.effectById(headEffect.value.id) ?? null) : null,
)

const defaultType = computed<EffectKind>(() => {
  if (!triggerAllows(props.trigger, 'animation')) return 'interaction'
  const halves = wrapped.value ? effects.halfIds(wrapped.value) : {}
  return !halves.animationId && halves.interactionId ? 'interaction' : 'animation'
})

const type = computed<EffectKind>(() => chosenType.value ?? defaultType.value)

const timeline = computed(() => {
  const halves = wrapped.value ? effects.halfIds(wrapped.value) : {}
  const id =
    halves.animationId ?? (headEffect.value?.kind === 'animation' ? headEffect.value.id : null)
  return id ? (animations.animationFor(id) ?? null) : null
})

function preview() {
  if (timeline.value && target.value) motion.preview(timeline.value, target.value.id)
}

function addAction() {
  const effect = createActionFor(props.trigger)
  if (effect) effectCreated(effect.id)
}

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

function cancel() {
  const effect = fresh.value ? effects.effectById(fresh.value) : null
  if (effect) effects.deleteEffect(effect)
  closeDrawer()
}

function apply() {
  keepEffect()
  closeDrawer()
}
</script>

<template>
  <div data-trigger-editor class="flex min-h-0 min-w-0 flex-1 flex-col">
    <p v-if="!canEdit" class="p-3 text-xs text-muted-foreground">
      Select a single element to manage what it does.
    </p>

    <div v-else-if="!rows.length" class="flex items-center gap-3 p-3">
      <p class="text-xs text-muted-foreground">Nothing runs on this trigger.</p>
      <ButtonUI variant="outline" size="xs" :icon="Plus" @click="addAction">Effect</ButtonUI>
      <ButtonUI variant="outline" size="xs" class="ml-auto" @click="cancel">Cancel</ButtonUI>
    </div>

    <div
      v-else
      class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[17rem_minmax(0,1fr)]"
    >
      <div
        class="custom-scrollbar flex min-h-0 flex-col overflow-x-hidden overflow-y-auto border-b border-input xl:border-r xl:border-b-0"
      >
        <p class="flex h-9 items-center px-2.5 section-label">
          Where
        </p>

        <RowUI v-if="wrapped && typeOptions.length > 1" label="Type">
          <div class="flex flex-1 justify-end gap-1">
            <ButtonUI
              v-for="option in typeOptions"
              :key="option.value"
              :variant="type === option.value ? 'outline' : 'ghost'"
              size="xs"
              :class="type === option.value ? '' : 'text-muted-foreground opacity-60'"
              @click="chosenType = option.value"
            >
              {{ option.label }}
            </ButtonUI>
          </div>
        </RowUI>

        <ActionOptions v-for="row in rows" :key="rowId(row)" :pair="row" :owner="target!" />

        <div v-if="timeline" class="px-2.5 pt-1">
          <ButtonUI
            variant="outline"
            size="sm"
            :icon="Play"
            class="w-full"
            @click="preview"
          >
            Preview
          </ButtonUI>
        </div>

        <div
          class="sticky bottom-0 mt-auto flex items-center gap-1.5 border-t border-input bg-background px-2.5 py-2"
        >
          <ButtonUI
            variant="ghost"
            size="xs"
            class="text-muted-foreground hover:!text-danger"
            @click="removeAction"
          >
            Remove
          </ButtonUI>
          <ButtonUI variant="outline" size="xs" class="ml-auto" @click="cancel">Cancel</ButtonUI>
          <ButtonUI variant="default" size="xs" @click="apply">Apply</ButtonUI>
        </div>
      </div>

      <div class="custom-scrollbar flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto">
        <EffectBody
          v-for="row in rows"
          :key="rowId(row)"
          v-bind="drawerRefOf(row)"
          :half="type"
          :name-row="false"
        />
      </div>
    </div>
  </div>
</template>
