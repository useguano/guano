<script setup lang="ts">
import { computed } from 'vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useEffects } from '@/composables/useEffects'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import type { DrawerKind } from '@/composables/useEffectsDrawer'

const props = withDefaults(defineProps<{ kind: DrawerKind; id: string; usage?: boolean }>(), {
  usage: true,
})

const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()

const wrapper = computed(() => (props.kind === 'effect' ? (effects.effectById(props.id) ?? null) : null))

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

function setName(value: string) {
  if (wrapper.value) effects.rename(wrapper.value, value)
  else if (effect.value) effect.value.name = value
}
</script>

<template>
  <div v-if="effect" class="flex min-w-0 items-center gap-2">
    <div :class="usage ? 'w-48 min-w-16 shrink' : 'min-w-0 flex-1'">
      <InputUI :model-value="effect.name" placeholder="Effect name" @update:model-value="setName" />
    </div>
    <span v-if="usage" class="shrink-0 text-[10px] text-muted-foreground">
      used on {{ usedOn }} element{{ usedOn === 1 ? '' : 's' }}
    </span>
  </div>
</template>
