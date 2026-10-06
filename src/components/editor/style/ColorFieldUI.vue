<script setup lang="ts">
import { computed, ref } from 'vue'
import ColorPickerUI from '@/components/ui/ColorPickerUI.vue'

// A color value text field (hex, palette name, keyword, or a project design
// token) with an autocomplete dropdown of the project's design tokens. Edits
// stay local until blur / Enter, then validate: valid text commits, invalid
// reverts. Empty commits as '' (unset). Focusing shows every token; typing
// filters by name. ↑/↓ + Enter pick a suggestion.
// With `swatch`, the palette picker rides inside the field rather than sitting
// beside it, so a colour is one control instead of two.

const props = withDefaults(
  defineProps<{
    /** committed value shown when not editing */
    modelValue: string
    /** project design tokens (name + hex) offered as suggestions */
    tokens: { name: string; value: string }[]
    /** guard applied to typed text before commit */
    validate?: (text: string) => boolean
    placeholder?: string
    /** resolved colour for the embedded picker; omit to hide the swatch */
    swatch?: string
  }>(),
  { placeholder: '–' },
)

const emit = defineEmits<{ commit: [string]; pick: [string] }>()

const editing = ref<string | null>(null)
const shown = computed(() => editing.value ?? props.modelValue)
const active = ref(0)

// while focused, suggest tokens — all of them until the user types, then
// filter by name (empty query lists everything so the palette is discoverable)
const filtered = computed(() => {
  if (editing.value === null) return []
  const q = editing.value.trim().toLowerCase()
  return q ? props.tokens.filter((t) => t.name.toLowerCase().includes(q)) : props.tokens
})
const open = computed(() => filtered.value.length > 0)

function onFocus() {
  editing.value = props.modelValue
  active.value = 0
}
function onInput(e: Event) {
  editing.value = (e.target as HTMLInputElement).value
  active.value = 0
}

function isValid(text: string): boolean {
  if (text === '') return true
  return props.validate ? props.validate(text) : true
}

function commit() {
  const raw = editing.value
  editing.value = null
  if (raw === null) return
  const text = raw.trim()
  if (!isValid(text)) return
  if (text !== props.modelValue) emit('commit', text)
}

function pick(name: string) {
  editing.value = null
  if (name !== props.modelValue) emit('commit', name)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' && open.value) {
    e.preventDefault()
    active.value = (active.value + 1) % filtered.value.length
  } else if (e.key === 'ArrowUp' && open.value) {
    e.preventDefault()
    active.value = (active.value - 1 + filtered.value.length) % filtered.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    // pick the highlighted token only when the user has typed a query that
    // matches one; a bare focus (no typing) just commits and blurs
    const typed = (editing.value ?? '').trim()
    if (open.value && typed !== '' && filtered.value[active.value]) {
      pick(filtered.value[active.value]!.name)
    }
    ;(e.target as HTMLInputElement).blur()
  } else if (e.key === 'Escape') {
    editing.value = null
    ;(e.target as HTMLInputElement).blur()
  }
}
</script>

<template>
  <div class="relative min-w-0 flex-1">
    <div v-if="swatch !== undefined" class="absolute top-1/2 left-1 z-10 -translate-y-1/2">
      <ColorPickerUI
        :model-value="swatch"
        size="sm"
        align="left"
        @update:model-value="(v) => emit('pick', v)"
      />
    </div>
    <input
      :value="shown"
      :placeholder="placeholder"
      spellcheck="false"
      class="h-7 w-full rounded-md bg-input pr-2 text-left font-mono text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
      :class="[
        modelValue === '' && editing === null ? 'text-muted-foreground' : 'text-foreground',
        swatch !== undefined ? 'pl-7' : 'pl-2',
      ]"
      @focus="onFocus"
      @input="onInput"
      @blur="commit"
      @keydown="onKeydown"
    />

    <div
      v-if="open"
      class="absolute top-full left-0 z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-input bg-background p-1 shadow-md"
    >
      <button
        v-for="(token, i) in filtered"
        :key="token.name"
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left font-mono text-[10px] transition-colors hover:bg-accent"
        :class="i === active && 'bg-accent'"
        @mousedown.prevent="pick(token.name)"
      >
        <span
          class="size-3.5 shrink-0 rounded-sm border border-input"
          :style="{ backgroundColor: token.value }"
        />
        <span class="min-w-0 flex-1 truncate">{{ token.name }}</span>
        <span class="shrink-0 text-muted-foreground">{{ token.value }}</span>
      </button>
    </div>
  </div>
</template>
