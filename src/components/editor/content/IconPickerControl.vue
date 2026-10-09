<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { LibraryBig } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useMedia } from '@/composables/useMedia'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import {
  DEFAULT_ICON_SVG,
  MAX_SVG_BYTES,
  lucideNameOf,
  lucideSvg,
  parseInlineSvg,
  sanitizeInlineSvg,
} from '@/lib/shared/svg.js'

const model = defineModel<string>({ default: '' })

const LIMIT = 84

const table = shallowRef<Record<string, string> | null>(null)
const query = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

onMounted(async () => {
  const mod = await import('@/lib/shared/lucideIcons.js')
  table.value = mod.LUCIDE_ICONS as Record<string, string>
})

const names = computed(() => (table.value ? Object.keys(table.value) : []))

const matches = computed(() => {
  const words = query.value.trim().toLowerCase().split(/[\s-]+/).filter(Boolean)
  if (!words.length) return names.value.slice(0, LIMIT)
  const out: string[] = []
  const head = words[0]!
  for (const pass of [true, false]) {
    for (const name of names.value) {
      if (name.startsWith(head) !== pass) continue
      if (words.every((w) => name.includes(w))) out.push(name)
      if (out.length >= LIMIT) return out
    }
  }
  return out
})

const current = computed(() => parseInlineSvg(model.value || DEFAULT_ICON_SVG))
const currentName = computed(() => lucideNameOf(model.value))
const currentLabel = computed(() => {
  if (!model.value) return 'No icon picked'
  return currentName.value ?? 'Custom SVG'
})

function pick(name: string) {
  const inner = table.value?.[name]
  if (!inner) return
  error.value = null
  model.value = lucideSvg(name, inner)
}

const { mediaUrl } = useMedia()
const { openSelect } = useMediaLibrary()

async function fromLibrary() {
  const asset = await openSelect(['image'])
  if (!asset) return
  error.value = null
  if (asset.mime !== 'image/svg+xml') {
    error.value = 'Pick an SVG file. Other images go in an image element.'
    return
  }
  busy.value = true
  try {
    const res = await fetch(mediaUrl(asset))
    if (!res.ok) throw new Error('Could not read that file')
    const text = await res.text()
    if (text.length > MAX_SVG_BYTES) {
      throw new Error(`That SVG is too large to inline (${Math.round(MAX_SVG_BYTES / 1024)} KB max)`)
    }
    const safe = sanitizeInlineSvg(text)
    if (!safe) throw new Error('That file has nothing an icon can use')
    model.value = safe
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not use that file'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center gap-2 rounded-lg bg-input p-1.5">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60">
        <svg v-if="current" v-bind="current.attrs" class="size-4" v-html="current.inner" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-xs" data-icon-current>{{ currentLabel }}</span>
        <span class="block text-[10px] text-muted-foreground">Follows the text colour</span>
      </span>
    </div>

    <InputUI v-model="query" placeholder="Search icons…" />

    <div
      class="grid max-h-44 grid-cols-7 gap-0.5 overflow-y-auto rounded-lg bg-input p-1"
      data-icon-grid
    >
      <button
        v-for="name in matches"
        :key="name"
        v-tooltip="name"
        type="button"
        :data-icon-option="name"
        :aria-label="name"
        class="flex aspect-square items-center justify-center rounded-md outline-none hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent"
        :class="name === currentName ? 'bg-accent/30 text-foreground' : 'text-muted-foreground'"
        @click="pick(name)"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-4"
          aria-hidden="true"
          v-html="table![name]"
        />
      </button>
      <p v-if="table && !matches.length" class="col-span-full p-2 text-[10px] text-muted-foreground">
        No icon matches “{{ query }}”.
      </p>
    </div>

    <ButtonUI variant="outline" size="sm" :icon="LibraryBig" :disabled="busy" @click="fromLibrary">
      {{ busy ? 'Reading…' : 'Use an SVG from the library' }}
    </ButtonUI>
    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
