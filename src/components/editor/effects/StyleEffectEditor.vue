<script setup lang="ts">
import { computed, ref } from 'vue'
import SelectUI from '@/components/ui/SelectUI.vue'
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

// the strip is one line: the classes, and — only while it is being worked in —
// the timing. Collapsed it is just what the effect applies.
const expanded = ref(false)

function onFocusIn() {
  expanded.value = true
}

function onFocusOut(event: FocusEvent) {
  const root = event.currentTarget as HTMLElement
  const next = event.relatedTarget as Node | null
  if (!next || !root.contains(next)) expanded.value = false
}
</script>

<template>
  <div
    v-if="effect"
    class="flex items-center gap-2 px-2.5 py-2"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <ClassFieldInput
      v-model="effect.toClasses"
      :prerequisites="false"
      drop-up
      class="min-w-0 flex-1 font-mono"
    />
    <template v-if="expanded">
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
    </template>
  </div>
</template>
