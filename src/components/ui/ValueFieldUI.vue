<script setup lang="ts">
import { ref, computed } from 'vue'
import { textToTail, arrowStepText } from '@/lib/valueClass'

// A compact text field for a style value (e.g. `4`, `4em`, `-4px`). Edits are
// local until blur / Enter, then validated: valid text commits, invalid text
// reverts to the last committed value. Empty commits as '' (unset).
// ↑/↓ nudge the value along `steps` (Shift = bigger jump).

const props = withDefaults(
  defineProps<{
    /** the committed value text shown when not editing */
    modelValue: string
    allowNegative?: boolean
    placeholder?: string
    /** override the default units guard (e.g. size values accept keywords) */
    validate?: (text: string) => boolean
    /** scale walked by ↑/↓ arrows for bare numbers */
    steps?: string[]
    /** keywords accepted verbatim (e.g. `auto`), skipped by arrow stepping */
    allowKeywords?: readonly string[]
  }>(),
  { allowNegative: false, placeholder: '–' },
)

const emit = defineEmits<{ commit: [string] }>()

const editing = ref<string | null>(null)
const shown = computed(() => editing.value ?? props.modelValue)

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
  // empty is a valid "unset"; otherwise must pass the guard
  if (!isValid(text)) return
  if (text !== props.modelValue) emit('commit', text)
}

function arrow(dir: 1 | -1, bigger: boolean) {
  const cur = (editing.value ?? props.modelValue).trim()
  // leave keywords (auto, full) untouched
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
  <input
    :value="shown"
    :placeholder="placeholder"
    spellcheck="false"
    class="h-7 w-14 shrink-0 rounded-md bg-input px-2 text-right font-mono text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
    :class="modelValue === '' && editing === null ? 'text-muted-foreground' : 'text-foreground'"
    @focus="onFocus"
    @input="onInput"
    @blur="commit"
    @keydown="onKeydown"
  />
</template>
