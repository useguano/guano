<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { useDropdown } from '@/composables/useDropdown'

// A select with the app's own panel instead of the native browser popup.
// The API is deliberately unchanged from the native version (options +
// v-model + placeholder, class falls through to the root) so every call site
// keeps working. The model only ever changes on a real pick — callers guard
// with `v && …`, so we never emit an empty value on close.
const props = defineProps<{
  options: { label: string; value: string }[]
  /** shown when the model is empty or matches no option */
  placeholder?: string
}>()

const model = defineModel<string>()

// outside-click only: Escape is handled locally (see onKeydown) because the
// sidebar panel owns window-level Escape and would close along with us
const { open, root, toggle, close } = useDropdown()
const panelEl = ref<HTMLElement>()
// keyboard cursor, seeded to the selected option each time the panel opens
const active = ref(0)

const selectedIndex = computed(() => props.options.findIndex((o) => o.value === model.value))
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label ?? '')

function scrollActiveIntoView() {
  nextTick(() => {
    panelEl.value?.children[active.value]?.scrollIntoView({ block: 'nearest' })
  })
}

function openPanel() {
  active.value = Math.max(0, selectedIndex.value)
  toggle()
  scrollActiveIntoView()
}

function pick(value: string) {
  model.value = value
  close()
}

function move(delta: number) {
  const n = props.options.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  scrollActiveIntoView()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) return openPanel()
    move(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (!open.value) return openPanel()
    const option = props.options[active.value]
    if (option) pick(option.value)
  } else if (e.key === 'Escape' && open.value) {
    // while open, Escape belongs to us; when closed it bubbles so the
    // surrounding panel can close (the ClassInput convention)
    e.stopPropagation()
    close()
  }
}
</script>

<template>
  <div ref="root" class="relative w-full">
    <button
      type="button"
      class="flex h-7 w-full cursor-pointer items-center rounded-lg bg-input pr-6 pl-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
      :class="selectedLabel ? 'text-foreground' : 'text-muted-foreground'"
      @click="open ? close() : openPanel()"
      @keydown="onKeydown"
    >
      <span class="min-w-0 flex-1 truncate">{{ selectedLabel || placeholder }}</span>
    </button>
    <ChevronDown
      class="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground transition-transform"
      :class="open && 'rotate-180'"
    />

    <div
      v-if="open"
      ref="panelEl"
      class="absolute top-full left-0 z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-input bg-background p-1 shadow-md"
    >
      <button
        v-for="(option, i) in options"
        :key="option.value"
        type="button"
        class="flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent/30"
        :class="i === active && 'bg-accent/30'"
        @mousedown.prevent="pick(option.value)"
      >
        <Check class="size-3 shrink-0" :class="option.value === model ? 'opacity-100' : 'opacity-0'" />
        <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>
