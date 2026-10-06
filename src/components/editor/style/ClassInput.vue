<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import { suggestClasses, applyClass, isStateClass } from '@/lib/styles'

const props = withDefaults(
  defineProps<{
    tokens: string[]
    /** auto-add flex/grid prerequisites (off for transition to-states) */
    prerequisites?: boolean
    /** tokens inherited from a larger breakpoint — shown dimmed. Removable only
     * when listed in `removableInherited`; otherwise add a conflicting class to
     * override (which then shows solid) */
    inherited?: string[]
    /** inherited tokens that can be removed here — removing scopes the class so
     * it drops on this breakpoint and smaller ones, larger ones keeping it */
    removableInherited?: string[]
  }>(),
  { prerequisites: true, inherited: () => [], removableInherited: () => [] },
)

function isInherited(token: string): boolean {
  return props.inherited.includes(token)
}

// removable = a normal (own) token, or a base-inherited token we can scope away
function isRemovable(token: string): boolean {
  return !isInherited(token) || props.removableInherited.includes(token)
}

const emit = defineEmits<{
  commit: [tokens: string[]]
  remove: [cls: string]
}>()

const query = ref('')
const active = ref(0)
const error = ref<string | null>(null)

// a fresh keystroke clears any standing error
watch(query, () => (error.value = null))

const inputEl = ref<HTMLInputElement>()
defineExpose({ focus: () => inputEl.value?.focus() })

// --- inline badge editing (double-click a class to edit its value) ---

const editingToken = ref<string | null>(null)
const editValue = ref('')
const editInputEl = ref<HTMLInputElement | null>(null)
const setEditRef = (el: unknown) => (editInputEl.value = el as HTMLInputElement | null)

watch(editValue, () => (error.value = null))

function startEdit(token: string) {
  editingToken.value = token
  editValue.value = token
  nextTick(() => {
    editInputEl.value?.focus()
    editInputEl.value?.select()
  })
}

function commitEdit() {
  const token = editingToken.value
  if (!token) return
  const trimmed = editValue.value.trim()
  // emptied → remove the class entirely
  if (!trimmed) {
    editingToken.value = null
    emit('remove', token)
    return
  }
  if (trimmed === token) {
    editingToken.value = null
    return
  }
  // validate the new value against the other tokens (old one dropped)
  const result = applyClass(trimmed, props.tokens.filter((t) => t !== token), {
    prerequisites: props.prerequisites,
  })
  if ('error' in result) {
    if (result.error) error.value = result.error
    return // keep the editor open so the user can fix it
  }
  emit('commit', result.tokens)
  editingToken.value = null
  error.value = null
}

function cancelEdit() {
  editingToken.value = null
  error.value = null
}

function onEditKeydown(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

const suggestions = computed(() => suggestClasses(query.value))
const open = computed(() => query.value.trim().length > 0 && suggestions.value.length > 0)

function commit(cls: string) {
  const value = cls.trim()
  if (!value) return
  // picking a bare variant prefix ("hover:") continues the query
  if (value.endsWith(':')) {
    query.value = value
    active.value = 0
    return
  }
  const result = applyClass(value, props.tokens, { prerequisites: props.prerequisites })
  if ('error' in result) {
    if (result.error) error.value = result.error
    return
  }
  emit('commit', result.tokens)
  query.value = ''
  active.value = 0
  error.value = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' && open.value) {
    e.preventDefault()
    active.value = (active.value + 1) % suggestions.value.length
  } else if (e.key === 'ArrowUp' && open.value) {
    e.preventDefault()
    active.value = (active.value - 1 + suggestions.value.length) % suggestions.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    commit(open.value ? (suggestions.value[active.value] ?? query.value) : query.value)
  } else if (e.key === 'Escape') {
    // with a query, Escape only clears it; empty, it bubbles up and
    // closes the panel (returning focus to the Layers tree)
    if (query.value) {
      e.stopPropagation()
      query.value = ''
      active.value = 0
    }
  } else if (e.key === 'Backspace' && !query.value && props.tokens.length) {
    // remove the last removable token
    const last = [...props.tokens].reverse().find((t) => isRemovable(t))
    if (last) emit('remove', last)
  } else {
    active.value = 0
  }
}
</script>

<template>
  <div class="relative">
    <div class="flex flex-wrap items-center gap-1">
      <template v-for="token in tokens" :key="token">
        <input
          v-if="editingToken === token"
          :ref="setEditRef"
          v-model="editValue"
          spellcheck="false"
          class="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground outline-none ring-1 ring-accent"
          :style="{ width: `calc(${Math.max(editValue.length, 1)}ch + 1.25rem)` }"
          @keydown="onEditKeydown"
          @blur="commitEdit"
        />
        <BadgeUI
          v-else
          :removable="isRemovable(token)"
          :variant="isStateClass(token) ? 'state' : 'default'"
          class="cursor-text"
          :class="isInherited(token) && 'opacity-50'"
          @remove="$emit('remove', token)"
          @dblclick="startEdit(token)"
        >
          {{ token }}
        </BadgeUI>
      </template>
      <input
        ref="inputEl"
        v-model="query"
        type="text"
        spellcheck="false"
        placeholder="Add class"
        class="h-6 min-w-20 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
        @keydown="onKeydown"
      />
    </div>

    <p v-if="error" class="mt-1 font-mono text-[10px] text-danger">{{ error }}</p>

    <div
      v-if="open"
      class="absolute top-full left-0 z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-input bg-background p-1 shadow-md"
    >
      <button
        v-for="(suggestion, i) in suggestions"
        :key="suggestion"
        class="block w-full cursor-pointer rounded px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-accent"
        :class="i === active && 'bg-accent'"
        @mousedown.prevent="commit(suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>
  </div>
</template>
