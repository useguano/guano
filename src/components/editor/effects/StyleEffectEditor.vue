<script setup lang="ts">
import { computed } from 'vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ClassFieldInput from '@/components/editor/style/ClassFieldInput.vue'
import { useInteraction } from '@/composables/useInteraction'

const props = defineProps<{ id: string }>()

const { animationFor } = useInteraction()

const effect = computed(() => animationFor(props.id))

const DURATION_OPTIONS = ['75', '100', '150', '200', '300', '500', '700', '1000'].map((ms) => ({
  label: `${ms}ms`,
  value: `duration-${ms}`,
}))

const EASING_PRESETS = [
  { label: 'Linear', value: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in' },
  { label: 'Ease out', value: 'ease-out' },
  { label: 'Ease in-out', value: 'ease-in-out' },
]

const easingOptions = computed(() => {
  const current = effect.value?.easing
  if (!current || EASING_PRESETS.some((e) => e.value === current)) return EASING_PRESETS
  return [{ label: `Custom · ${current.replace(/^ease-/, '')}`, value: current }, ...EASING_PRESETS]
})

const durationOptions = computed(() => {
  const current = effect.value?.duration
  if (!current || DURATION_OPTIONS.some((d) => d.value === current)) return DURATION_OPTIONS
  return [{ label: current.replace(/^duration-/, '') + 'ms', value: current }, ...DURATION_OPTIONS]
})
</script>

<template>
  <div v-if="effect" class="flex items-center gap-2 px-2.5 py-2">
    <ClassFieldInput v-model="effect.toClasses" :prerequisites="false" class="min-w-0 flex-1 font-mono" />
    <div class="w-24 shrink-0">
      <SelectUI
        :model-value="effect.duration"
        :options="durationOptions"
        @update:model-value="(v) => v && (effect!.duration = v)"
      />
    </div>
    <div class="w-32 shrink-0">
      <SelectUI
        :model-value="effect.easing"
        :options="easingOptions"
        @update:model-value="(v) => v && (effect!.easing = v)"
      />
    </div>

    <ButtonUI
      variant="outline"
      size="sm"
      class="shrink-0"
      tooltip="Lock scroll and trap focus while this is on"
      :class="effect.modal && 'bg-accent text-accent-foreground'"
      @click="effect!.modal = effect!.modal ? undefined : true"
    >
      Modal
    </ButtonUI>
  </div>
</template>
