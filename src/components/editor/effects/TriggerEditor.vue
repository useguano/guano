<script setup lang="ts">
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ActionOptions from '@/components/editor/interactions/ActionOptions.vue'
import EffectBody from '@/components/editor/effects/EffectBody.vue'
import { useElementEffects } from '@/composables/useElementEffects'
import { useEffects } from '@/composables/useEffects'
import { NEW_ACTION, useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { triggerAllows, type EffectKind } from '@/lib/effectTriggers'

const props = defineProps<{ trigger: string }>()

const { target, canEdit, actions, createActionFor } = useElementEffects()
const effects = useEffects()
const animations = useAnimation()
const motion = useMotion()
const { action, openTrigger, closeDrawer } = useEffectsDrawer()

const rows = computed(() => actions.value.filter((a) => a.trigger === props.trigger))
const row = computed(() => {
  if (action.value === NEW_ACTION) return null
  return rows.value.find((r) => r.key === action.value) ?? rows.value[0] ?? null
})
const headEffect = computed(() => row.value?.ref ?? null)

const KINDS: EffectKind[] = ['interaction', 'animation']
// a trigger that can run only one engine shows that half alone; every other
// trigger shows both, timeline first with the class strip under it
const only = computed(() => {
  const allowed = KINDS.filter((k) => triggerAllows(props.trigger, k))
  return allowed.length === 1 ? allowed[0] : undefined
})

const wrapped = computed(() =>
  headEffect.value?.kind === 'effect' ? (effects.effectById(headEffect.value.id) ?? null) : null,
)

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
  const made = createActionFor(props.trigger)
  if (!made) return
  openTrigger(props.trigger, made.key || null)
}
</script>

<template>
  <div data-trigger-editor class="flex min-h-0 min-w-0 flex-1 flex-col">
    <p v-if="!canEdit" class="p-3 text-xs text-muted-foreground">
      Select a single element to manage what it does.
    </p>

    <div v-else-if="!row" class="flex flex-col items-start gap-2 p-3">
      <p class="text-xs text-muted-foreground">Nothing runs on this trigger.</p>
      <ButtonUI variant="outline" size="xs" :icon="Plus" @click="addAction">New effect</ButtonUI>
      <p class="text-[10px] text-muted-foreground">
        Or apply one from the effects library on the left — it stays one effect, shared by
        every element using it.
      </p>
    </div>

    <div
      v-else
      class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_17rem]"
    >
      <div class="custom-scrollbar flex min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto">
        <EffectBody :key="row.key" v-bind="row.ref" :half="only" :name-row="false" />
      </div>
      <div
        class="custom-scrollbar flex min-h-0 flex-col overflow-x-hidden overflow-y-auto border-t border-input xl:border-t-0 xl:border-l"
      >
        <p class="flex h-9 items-center px-2.5 section-label">
          Where
        </p>

        <ActionOptions :key="row.key" :pair="row.pair" :owner="target!" />

        <div
          class="sticky bottom-0 mt-auto flex items-center gap-1.5 border-t border-input bg-background px-2.5 py-2"
        >
          <ButtonUI v-if="timeline" variant="default" size="xs" @click="preview">
            Preview
          </ButtonUI>
          <ButtonUI variant="outline" size="xs" class="ml-auto" @click="closeDrawer">
            Close
          </ButtonUI>
        </div>
      </div>
    </div>
  </div>
</template>
