<script setup lang="ts">
import { ref, computed } from 'vue'
import { textToTail, arrowStepText } from '@/lib/valueClass'

const props = withDefaults(
  defineProps<{
    modelValue: string
    allowNegative?: boolean
    placeholder?: string
    validate?: (text: string) => boolean
    steps?: string[]
    allowKeywords?: readonly string[]

    unit?: string

    full?: boolean
  }>(),
  { allowNegative: false, placeholder: '–' },
)

const emit = defineEmits<{ commit: [string] }>()

const editing = ref<string | null>(null)
const shown = computed(() => editing.value ?? props.modelValue)

const inputClass = computed(() => [
  'h-7 rounded-md bg-input px-2 text-right font-mono text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent',
  props.unit ? 'w-full pr-6' : props.full ? 'w-full' : 'w-14 shrink-0',
  props.modelValue === '' && editing.value === null ? 'text-muted-foreground' : 'text-foreground',
])

function onFocus() {
  editing.value = props.modelValue
}

function onInput(e: Event) {
  editing.value = (e.target as HTMLInputElement).value
}

function isValid(text: string): boolean {
  if (text === '') return true
  return props.validate
    ? props.validate(text)
    : textToTail(text, { allowNegative: props.allowNegative, allowKeywords: props.allowKeywords }) !== false
}

function commit() {
  const raw = editing.value
  editing.value = null
  if (raw === null) return
  const text = raw.trim()
  if (!isValid(text)) return
  if (text !== props.modelValue) emit('commit', text)
}

function arrow(dir: 1 | -1, bigger: boolean) {
  const cur = (editing.value ?? props.modelValue).trim()
  if (props.allowKeywords?.includes(cur.toLowerCase())) return
  const next = arrowStepText(cur, dir, {
    steps: props.steps,
    bigger,
    allowNegative: props.allowNegative,
  })
  if (next === null || !isValid(next)) return
  editing.value = next
  emit('commit', next)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  else if (e.key === 'Escape') {
    editing.value = null
    ;(e.target as HTMLInputElement).blur()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    arrow(1, e.shiftKey)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    arrow(-1, e.shiftKey)
  }
}
</script>

<template>
  <div v-if="unit" class="relative flex w-full">
    <input
      :value="shown"
      :placeholder="placeholder"
      spellcheck="false"
      :class="inputClass"
      @focus="onFocus"
      @input="onInput"
      @blur="commit"
      @keydown="onKeydown"
    />
    <span
      class="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10px] text-muted-foreground"
    >
      {{ unit }}
    </span>
  </div>
  <input
    v-else
    :value="shown"
    :placeholder="placeholder"
    spellcheck="false"
    :class="inputClass"
    @focus="onFocus"
    @input="onInput"
    @blur="commit"
    @keydown="onKeydown"
  />
</template>
