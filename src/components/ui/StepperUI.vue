<script setup lang="ts">
import { computed } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import { tailToText, textToTail, nearestStepIndex } from '@/lib/valueClass'
import ValueFieldUI from './ValueFieldUI.vue'

// A compact ‹ − value + › stepper over an ordered list of step values.
// modelValue null = unset (shows –); stepping below the first step clears it.
// With allowCustom the value becomes an editable field: the model may then hold
// an off-scale / arbitrary "tail" (e.g. '[4em]', '-4') and the − / + buttons
// nudge the nearest scale stop.
const props = withDefaults(
  defineProps<{
    steps: string[]
    modelValue: string | null
    allowCustom?: boolean
    allowNegative?: boolean
    /** keywords the field accepts verbatim (e.g. `auto` for margins) */
    allowKeywords?: readonly string[]
  }>(),
  { allowCustom: false, allowNegative: false },
)
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const neg = computed(() => (props.modelValue ?? '').startsWith('-'))
const text = computed(() => tailToText(props.modelValue))

// index into `steps` for the current value: exact member, else nearest by magnitude
const index = computed(() => {
  if (props.modelValue === null) return -1
  const magnitude = props.modelValue.replace(/^-/, '')
  const exact = props.steps.indexOf(magnitude)
  return exact !== -1 ? exact : nearestStepIndex(props.steps, text.value)
})
const canDec = computed(() => index.value >= 0)
const canInc = computed(() => index.value < props.steps.length - 1)

// stepping keeps the current sign but writes a clean scale value
function emitMagnitude(mag: string | null) {
  if (mag === null) emit('update:modelValue', null)
  else emit('update:modelValue', neg.value ? `-${mag}` : mag)
}
function dec() {
  if (index.value <= 0) emit('update:modelValue', null)
  else emitMagnitude(props.steps[index.value - 1]!)
}
function inc() {
  if (index.value === -1) emitMagnitude(props.steps[0]!)
  else if (canInc.value) emitMagnitude(props.steps[index.value + 1]!)
}

// --- editable field ---

function onCommit(value: string) {
  if (value === '') return emit('update:modelValue', null)
  const tail = textToTail(value, { allowNegative: props.allowNegative, allowKeywords: props.allowKeywords })
  if (tail === false || tail === null) return
  emit('update:modelValue', tail)
}
</script>

<template>
  <div class="flex h-7 min-w-0 flex-1 items-center rounded-md border border-input bg-background">
    <button
      class="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
      :disabled="!canDec"
      @click="dec"
    >
      <Minus class="size-3" />
    </button>
    <ValueFieldUI
      v-if="allowCustom"
      :model-value="text"
      :allow-negative="allowNegative"
      :allow-keywords="allowKeywords"
      :steps="steps"
      class="!h-full !w-auto min-w-0 flex-1 !bg-transparent !text-center"
      @commit="onCommit"
    />
    <span
      v-else
      class="min-w-0 flex-1 text-center font-mono text-xs"
      :class="modelValue === null ? 'text-muted-foreground' : 'text-foreground'"
    >
      {{ modelValue === null ? '–' : text }}
    </span>
    <button
      class="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
      :disabled="!canInc"
      @click="inc"
    >
      <Plus class="size-3" />
    </button>
  </div>
</template>
