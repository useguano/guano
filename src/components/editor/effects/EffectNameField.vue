<script setup lang="ts">
// An effect's name and who uses it — one field, shown wherever an effect is
// edited (the trigger view's header, the library view's body).
//
// Takes a kind + id and re-resolves, never an object: undo and a branch switch
// swap the whole project graph, so a held object would detach silently.
import { computed } from 'vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useEffects } from '@/composables/useEffects'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import type { DrawerKind } from '@/composables/useEffectsDrawer'

const props = defineProps<{ kind: DrawerKind; id: string }>()

const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()

const wrapper = computed(() => (props.kind === 'effect' ? (effects.effectById(props.id) ?? null) : null))

/** what the field names — the effect, or the lone half */
const effect = computed(() => {
  if (props.kind === 'effect') return wrapper.value
  return props.kind === 'interaction'
    ? (interactions.animationFor(props.id) ?? null)
    : (animations.animationFor(props.id) ?? null)
})

const usedOn = computed(() => {
  if (props.kind === 'effect') return wrapper.value ? effects.usageCount(wrapper.value) : 0
  return props.kind === 'interaction'
    ? interactions.usageCount(props.id)
    : animations.usageCount(props.id)
})

/** an effect's halves carry its name too, so the two libraries read the same
 *  way from anywhere that still shows them */
function setName(value: string) {
  if (wrapper.value) effects.rename(wrapper.value, value)
  else if (effect.value) effect.value.name = value
}
</script>

<template>
  <div v-if="effect" class="flex min-w-0 items-center gap-2">
    <div class="w-48 min-w-24 shrink">
      <InputUI :model-value="effect.name" placeholder="Effect name" @update:model-value="setName" />
    </div>
    <span class="shrink-0 text-[10px] text-muted-foreground">
      used on {{ usedOn }} element{{ usedOn === 1 ? '' : 's' }}
    </span>
  </div>
</template>
