<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronLeft, Search, TriangleAlert, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useElement } from '@/composables/useElement'
import { usePage } from '@/composables/usePage'
import { useProject } from '@/composables/useProject'
import { useComponents } from '@/composables/useComponents'
import { useStructure } from '@/composables/useStructure'
import { validateContext, validateTree } from '@/lib/validateTree'
import LayerRow from './LayerRow.vue'
import { useLayerSurface } from './useLayerSurface'
import { layerLabel } from './layerLabel'
import { provideLayerFilter } from './layerFilter'
import type { ElementNode } from '@/types/editor'

const emit = defineEmits<{ back: [] }>()

const { activePage } = usePage()
const { project } = useProject()
const { masterFor } = useComponents()
const { selectElement } = useElement()
const { backend } = useStructure()

const roots = computed(() => backend.value.roots.value)
const isPage = computed(() => backend.value.kind === 'page')
const title = computed(() => activePage.value?.name ?? 'Layers')

const searching = ref(false)
const query = ref('')
const queryInput = ref<HTMLInputElement>()

async function openSearch() {
  searching.value = true
  await nextTick()
  queryInput.value?.focus()
}

function closeSearch() {
  searching.value = false
  query.value = ''
}

watch(() => activePage.value?.id, closeSearch)

const visibleIds = computed<Set<string> | null>(() => {
  const needle = query.value.trim().toLowerCase()
  if (!searching.value || !needle) return null
  const keep = new Set<string>()
  const walk = (node: ElementNode, ancestors: string[]) => {
    const path = [...ancestors, node.id]
    const hit = layerLabel(node, masterFor).toLowerCase().includes(needle)
      || node.type.toLowerCase().includes(needle)
    if (hit) for (const id of path) keep.add(id)
    for (const child of node.children) walk(child, path)
  }
  for (const root of roots.value) walk(root, [])
  return keep
})
provideLayerFilter(visibleIds)

const noMatches = computed(() => !!visibleIds.value && visibleIds.value.size === 0)

const surface = ref<HTMLElement>()
const { onKeydown } = useLayerSurface({
  surface,
  roots: () => roots.value,
  canRename: () => isPage.value,
})

const issues = computed(() => {
  const ctx = validateContext(project.value)
  if (isPage.value) {
    const body = activePage.value?.elements.find((n) => n.type === 'body')
    return body ? validateTree(body, ctx) : []
  }
  return roots.value.flatMap((root) => validateTree(root, ctx))
})
</script>

<template>
  <div
    ref="surface"
    data-insert-surface
    class="flex h-full flex-col outline-none"
    tabindex="0"
    @keydown="onKeydown"
  >
    <div class="flex h-11 shrink-0 items-center gap-1 px-1.5">
      <ButtonUI
        variant="icon"
        size="sm"
        :icon="ChevronLeft"
        tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="emit('back')"
      />
      <template v-if="searching">
        <div class="relative min-w-0 flex-1">
          <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref="queryInput"
            v-model="query"
            type="text"
            spellcheck="false"
            placeholder="Search layers…"
            aria-label="Search layers"
            class="h-7 w-full rounded-lg bg-input pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
            @keydown.stop
            @keydown.esc.prevent="closeSearch"
          />
        </div>
        <ButtonUI
          variant="icon"
          size="sm"
          :icon="X"
          class="w-7 shrink-0 text-muted-foreground"
          @click="closeSearch"
        />
      </template>
      <template v-else>
        <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ title }}</span>
        <ButtonUI
          variant="icon"
          size="sm"
          :icon="Search"
          tooltip="Search layers"
          class="w-7 shrink-0 text-muted-foreground"
          @click="openSearch"
        />
      </template>
    </div>

    <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-1 pb-8">
      <LayerRow v-for="node in roots" :key="node.id" :node="node" :depth="0" />
      <p v-if="noMatches" class="px-2 py-6 text-center text-xs text-muted-foreground">
        No layer matches.
      </p>
      <p v-else-if="!roots.length" class="px-2 py-6 text-center text-xs text-muted-foreground">
        Nothing here yet.
      </p>
    </div>

    <div v-if="issues.length" class="shrink-0 border-t border-input">
      <div class="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[9px] font-medium tracking-wide text-pending uppercase">
        <TriangleAlert class="size-3" />
        {{ issues.length }} {{ issues.length === 1 ? 'issue' : 'issues' }}
      </div>
      <div class="custom-scrollbar max-h-28 overflow-y-auto pb-1.5">
        <button
          v-for="issue in issues"
          :key="`${issue.nodeId}:${issue.message}`"
          type="button"
          class="flex w-full items-start gap-1 px-2.5 py-1 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent/20 hover:text-foreground"
          @click="selectElement(issue.nodeId)"
        >
          {{ issue.message }}
        </button>
      </div>
    </div>
  </div>
</template>
