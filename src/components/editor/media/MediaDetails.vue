<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Copy, Download, RefreshCw, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import type { MediaAsset } from '@/types/media'
import type { MediaUsage } from '@/types/media'
import { useMedia } from '@/composables/useMedia'
import { useProject } from '@/composables/useProject'
import { walkNodes } from '@/lib/tree'
import { acceptFor, formatBytes } from '@/lib/media'

const props = defineProps<{
  asset: MediaAsset
  /** cache-buster for previews, bumped by the parent after replace */
  version: number
}>()

const emit = defineEmits<{ replaced: []; delete: [] }>()

const { mediaUrl, updateAsset, replaceAsset, folders, usage } = useMedia()
const { project } = useProject()

// name/alt edit locally, commit on change/blur — not on every keystroke
const name = ref(props.asset.name)
const alt = ref(props.asset.alt ?? '')
watch(
  () => props.asset.id,
  () => {
    name.value = props.asset.name
    alt.value = props.asset.alt ?? ''
  },
)

async function commitName() {
  const value = name.value.trim()
  if (!value || value === props.asset.name) {
    name.value = props.asset.name
    return
  }
  await updateAsset(props.asset.id, { name: value })
}

async function commitAlt() {
  if ((props.asset.alt ?? '') === alt.value) return
  await updateAsset(props.asset.id, { alt: alt.value })
}

// '' = root; SelectUI models strings
const folderModel = computed({
  get: () => props.asset.folderId ?? '',
  set: (value: string) => void updateAsset(props.asset.id, { folderId: value || null }),
})
/** full "Parent / Child" path for a nested folder */
function folderPath(id: string): string {
  const names: string[] = []
  const seen = new Set<string>()
  let cur = folders.value.find((f) => f.id === id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    names.unshift(cur.name)
    cur = cur.parentId ? folders.value.find((f) => f.id === cur!.parentId) : undefined
  }
  return names.join(' / ')
}
const folderOptions = computed(() => [
  { label: 'No folder', value: '' },
  ...folders.value
    .map((f) => ({ label: folderPath(f.id), value: f.id }))
    .sort((a, b) => a.label.localeCompare(b.label)),
])

// replace-in-place: same id/URL, new bytes
const replaceInput = ref<HTMLInputElement>()
const busy = ref(false)
const error = ref<string | null>(null)

async function onReplaceFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  busy.value = true
  error.value = null
  try {
    await replaceAsset(props.asset.id, file)
    emit('replaced')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'replace failed'
  } finally {
    busy.value = false
  }
}

const previewSrc = computed(() =>
  props.asset.kind === 'image' || props.asset.kind === 'video'
    ? `${mediaUrl(props.asset)}?v=${props.version}`
    : null,
)

const uploadedOn = computed(() =>
  new Date(props.asset.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }),
)

// ----- where it's used -----
// precise walk of the loaded branch (page names), plus the server's
// cross-branch reference count for everything this client can't see
const usedOn = computed(() => {
  const url = mediaUrl(props.asset)
  const refersTo = (src?: string) => src === url
  const nodeRefs = (n: { src?: string; locales?: Record<string, { src?: string }> }) =>
    (refersTo(n.src) ? 1 : 0) +
    Object.values(n.locales ?? {}).filter((o) => refersTo(o.src)).length

  const spots: { label: string; count: number }[] = []
  for (const page of project.value.pages) {
    let count = 0
    walkNodes(page.elements, (n) => (count += nodeRefs(n)))
    if (count) spots.push({ label: page.name, count })
  }
  let componentRefs = 0
  for (const c of project.value.components) walkNodes([c.root], (n) => (componentRefs += nodeRefs(n)))
  if (componentRefs) spots.push({ label: 'Components', count: componentRefs })
  let entryRefs = 0
  for (const c of project.value.collections) {
    for (const entry of c.entries) {
      // reference fields hold id arrays, never media srcs
      entryRefs += Object.values(entry.values).filter(
        (v) => typeof v === 'string' && refersTo(v),
      ).length
      for (const values of Object.values(entry.locales ?? {})) {
        entryRefs += Object.values(values).filter(refersTo).length
      }
    }
  }
  if (entryRefs) spots.push({ label: 'Collection entries', count: entryRefs })
  return spots
})

// cross-branch total from the server (this branch included)
const branchUsage = ref<MediaUsage | null>(null)
watch(
  () => props.asset.id,
  (id) => {
    branchUsage.value = null
    usage(id)
      .then((u) => {
        if (id === props.asset.id) branchUsage.value = u
      })
      .catch(() => {})
  },
  { immediate: true },
)
/** shown only when this branch has no usage: references saved on other branches */
const usageFallback = computed(() => {
  if (branchUsage.value?.total) {
    const n = branchUsage.value.branches.length
    return `${branchUsage.value.total} saved reference${branchUsage.value.total === 1 ? '' : 's'} on ${n} branch${n === 1 ? '' : 'es'}`
  }
  return 'Not used anywhere'
})

// ----- copy the public URL (the same /media/<id> stored on nodes) -----
const copied = ref(false)
function copyUrl() {
  navigator.clipboard
    .writeText(new URL(mediaUrl(props.asset), location.origin).href)
    .then(() => {
      copied.value = true
      setTimeout(() => (copied.value = false), 1600)
    })
    .catch(() => {})
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" style="scrollbar-gutter: stable">
    <!-- preview: checkerboard so transparent images read as transparent -->
    <div
      class="group relative flex h-56 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/60"
      :class="asset.kind === 'image' && 'checkerboard'"
    >
      <!-- replace in place: same id/URL, new bytes — on the preview, where
           the thing being replaced is -->
      <ButtonUI
        variant="outline"
        size="xs"
        :icon="RefreshCw"
        :disabled="busy"
        class="absolute top-2 right-2 z-10 bg-background/90 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        @click="replaceInput?.click()"
      >
        {{ busy ? 'Replacing…' : 'Replace' }}
      </ButtonUI>
      <img
        v-if="asset.kind === 'image'"
        :src="previewSrc!"
        :alt="asset.alt ?? asset.name"
        class="max-h-56 max-w-full object-contain"
      />
      <video v-else-if="asset.kind === 'video'" :src="previewSrc!" controls class="max-h-56 max-w-full" />
      <span v-else class="px-4 text-xs text-muted-foreground">{{ asset.mime }}</span>
    </div>

    <div class="flex flex-col gap-2">
      <RowUI label="Name">
        <InputUI v-model="name" placeholder="Asset name" @change="commitName" />
      </RowUI>
      <RowUI v-if="asset.kind === 'image'" label="Alt text">
        <TextareaUI v-model="alt" placeholder="Default alt text" @change="commitAlt" />
      </RowUI>
      <RowUI label="Folder">
        <SelectUI v-model="folderModel" :options="folderOptions" />
      </RowUI>
    </div>

    <div class="flex flex-col rounded-xl border border-input">
      <div class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Type</span>
        <span class="text-xs">{{ asset.mime }}</span>
      </div>
      <div class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Size</span>
        <span class="text-xs">{{ formatBytes(asset.size) }}</span>
      </div>
      <div v-if="asset.width" class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Dimensions</span>
        <span class="text-xs">{{ asset.width }} × {{ asset.height }}</span>
      </div>
      <div class="flex justify-between border-b border-input px-3 py-2">
        <span class="text-xs text-muted-foreground">Uploaded</span>
        <span class="text-xs">{{ uploadedOn }}</span>
      </div>
      <div class="flex items-center gap-2 px-3 py-2">
        <span class="shrink-0 text-xs text-muted-foreground">URL</span>
        <span class="min-w-0 flex-1 truncate text-right font-mono text-[10px]">
          {{ mediaUrl(asset) }}
        </span>
        <ButtonUI
          variant="icon"
          size="xs"
          :icon="copied ? Check : Copy"
          :tooltip="copied ? 'Copied' : 'Copy URL'"
          class="w-5 shrink-0 text-muted-foreground"
          :class="copied && '!text-success'"
          @click="copyUrl"
        />
      </div>
    </div>

    <!-- where it's used: one row per place, not a comma-joined string -->
    <div class="flex flex-col gap-1">
      <span class="px-0.5 section-label">
        Used on
      </span>
      <template v-if="usedOn.length">
        <div
          v-for="spot in usedOn"
          :key="spot.label"
          class="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent/20"
        >
          <span class="min-w-0 flex-1 truncate text-xs">{{ spot.label }}</span>
          <span v-if="spot.count > 1" class="shrink-0 text-[10px] text-muted-foreground">
            ×{{ spot.count }}
          </span>
        </div>
      </template>
      <p v-else class="px-2 py-1 text-xs text-muted-foreground">{{ usageFallback }}</p>
    </div>

      <p v-if="error" class="text-xs text-danger">{{ error }}</p>
    </div>

    <!-- actions stay pinned: the preview must never push them out of reach -->
    <div class="flex shrink-0 flex-col gap-1.5 border-t border-input p-4">
      <div class="grid grid-cols-2 gap-1.5">
        <a :href="`${mediaUrl(asset)}?download=1`" :download="asset.filename" class="contents">
          <ButtonUI variant="outline" size="sm" :icon="Download" class="w-full justify-start">
            Download
          </ButtonUI>
        </a>
        <ButtonUI
          variant="outline"
          size="sm"
          :icon="Trash2"
          class="justify-start !border-danger/40 text-danger hover:!bg-danger/10"
          @click="emit('delete')"
        >
          Delete
        </ButtonUI>
      </div>
      <input
        ref="replaceInput"
        type="file"
        :accept="acceptFor()"
        class="hidden"
        @change="onReplaceFile"
      />
    </div>
  </div>
</template>

<style scoped>
/* transparency grid behind image previews */
.checkerboard {
  background-image:
    linear-gradient(45deg, var(--color-muted) 25%, transparent 25%),
    linear-gradient(-45deg, var(--color-muted) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--color-muted) 75%),
    linear-gradient(-45deg, transparent 75%, var(--color-muted) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}
</style>
