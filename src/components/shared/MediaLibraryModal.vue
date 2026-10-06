<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  FolderPlus,
  Image as ImageIcon,
  FolderInput,
  Folder as FolderIcon,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import MediaGrid from '@/components/editor/media/MediaGrid.vue'
import MediaDetails from '@/components/editor/media/MediaDetails.vue'
import { useMedia } from '@/composables/useMedia'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useModal } from '@/composables/useModal'
import { acceptFor, formatBytes, KIND_LABELS } from '@/lib/media'
import type { MediaAsset, MediaFolder, MediaKind } from '@/types/media'

const emit = defineEmits<{ close: [] }>()

const {
  assets, folders, loaded, loadMedia, upload, updateAsset, removeAsset, usage,
  createFolder, renameFolder, moveFolder, removeFolder, thumbUrl, mediaUrl,
} = useMedia()
const { selectAccept, pick } = useMediaLibrary()
const { confirm } = useModal()

function pickAndClose(asset: MediaAsset) {
  pick(asset)
  emit('close')
}

const loadError = ref<string | null>(null)
onMounted(() => {
  loadMedia().catch((err) => {
    loadError.value = err instanceof Error ? err.message : 'could not load the media library'
  })
})

const selecting = computed(() => selectAccept.value !== null)

// ----- toolbar state -----
const KINDS = Object.keys(KIND_LABELS) as MediaKind[]
const type = ref<'all' | MediaKind>('all')
const query = ref('')
const view = ref<'grid' | 'list'>('grid')
const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'list', label: 'List', icon: List },
] as const
const sortKey = ref<'date' | 'name' | 'size' | 'type'>('date')
const sortDir = ref<'asc' | 'desc'>('desc')
const sizeFilter = ref<'any' | 's' | 'm' | 'l' | 'xl'>('any')
const dateFilter = ref<'any' | 'today' | '7d' | '30d' | '1y'>('any')

/** kinds shown as chips — narrowed to the accepted set in select mode */
const visibleKinds = computed(() => KINDS.filter((k) => !selectAccept.value || selectAccept.value.includes(k)))

const SORT_OPTIONS = [
  { label: 'Date', value: 'date' },
  { label: 'Name', value: 'name' },
  { label: 'Size', value: 'size' },
  { label: 'Type', value: 'type' },
]
const SIZE_OPTIONS = [
  { label: 'Any size', value: 'any' },
  { label: '< 100 KB', value: 's' },
  { label: '100 KB – 1 MB', value: 'm' },
  { label: '1 – 10 MB', value: 'l' },
  { label: '> 10 MB', value: 'xl' },
]
const DATE_OPTIONS = [
  { label: 'Any date', value: 'any' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last year', value: '1y' },
]

/** badge on the Filter button — sort isn't a filter, so it doesn't count */
const activeFilters = computed(
  () => (sizeFilter.value !== 'any' ? 1 : 0) + (dateFilter.value !== 'any' ? 1 : 0),
)
const filtersDirty = computed(
  () => !!activeFilters.value || sortKey.value !== 'date' || sortDir.value !== 'desc',
)
function resetFilters() {
  sortKey.value = 'date'
  sortDir.value = 'desc'
  sizeFilter.value = 'any'
  dateFilter.value = 'any'
}

// ----- folder navigation -----
const currentFolderId = ref<string | null>(null)

// any active filter/search flattens the view: show every match across folders
const flatMode = computed(
  () =>
    type.value !== 'all' ||
    !!query.value.trim() ||
    sizeFilter.value !== 'any' ||
    dateFilter.value !== 'any',
)

const breadcrumb = computed(() => {
  const chain: MediaFolder[] = []
  let id: string | undefined = currentFolderId.value ?? undefined
  while (id) {
    const f = folders.value.find((x) => x.id === id)
    if (!f) break
    chain.unshift(f)
    id = f.parentId
  }
  return chain
})

function inSizeBucket(size: number, b: typeof sizeFilter.value): boolean {
  const KB = 1024
  const MB = 1024 * 1024
  if (b === 's') return size < 100 * KB
  if (b === 'm') return size >= 100 * KB && size < MB
  if (b === 'l') return size >= MB && size < 10 * MB
  if (b === 'xl') return size >= 10 * MB
  return true
}
function inDateRange(createdAt: string, d: typeof dateFilter.value): boolean {
  if (d === 'any') return true
  const day = 86_400_000
  const span = d === 'today' ? day : d === '7d' ? 7 * day : d === '30d' ? 30 * day : 365 * day
  return Date.now() - new Date(createdAt).getTime() <= span
}

function matches(a: MediaAsset): boolean {
  if (selectAccept.value && !selectAccept.value.includes(a.kind)) return false
  if (type.value !== 'all' && a.kind !== type.value) return false
  const q = query.value.trim().toLowerCase()
  if (q && !(a.name.toLowerCase().includes(q) || a.filename.toLowerCase().includes(q))) return false
  if (!inSizeBucket(a.size, sizeFilter.value)) return false
  if (!inDateRange(a.createdAt, dateFilter.value)) return false
  return true
}

function sortAssets(list: MediaAsset[]): MediaAsset[] {
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    let cmp = 0
    if (sortKey.value === 'name') cmp = a.name.localeCompare(b.name)
    else if (sortKey.value === 'size') cmp = a.size - b.size
    else if (sortKey.value === 'type') cmp = a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
    else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return cmp * dir
  })
}

const visibleAssets = computed(() => {
  const list = flatMode.value
    ? assets.value.filter(matches)
    : assets.value.filter((a) => (a.folderId ?? null) === currentFolderId.value && matches(a))
  return sortAssets(list)
})
const visibleFolders = computed(() =>
  flatMode.value
    ? []
    : [...folders.value.filter((f) => (f.parentId ?? null) === currentFolderId.value)].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
)
const isEmpty = computed(() => !visibleFolders.value.length && !visibleAssets.value.length)

/** direct asset count per folder, for the folder chips */
const folderCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const a of assets.value) {
    if (a.folderId) counts[a.folderId] = (counts[a.folderId] ?? 0) + 1
  }
  return counts
})

// ----- selection (single → details rail, multiple → floating batch pill) -----
const selectedIds = ref<string[]>([])
// ---- the details rail is sized to the grid, not the other way round ----
// The grid is `repeat(auto-fill, minmax(9.5rem, 1fr))`: n columns of equal
// width col = (G − (n−1)·gap) / n over the content width G. A rail of any
// other width makes the columns re-solve and every tile changes size on each
// selection. A rail of exactly 2·col + 2·gap removes two whole columns and
// leaves col unchanged, so tiles never move.
const TILE_MIN = 152 // 9.5rem
const TILE_GAP = 12 // gap-3
const CONTENT_PAD = 32 // p-4 both sides
const contentEl = ref<HTMLElement>()
const railWidth = ref(288)
let ro: ResizeObserver | null = null
function measureRail() {
  const el = contentEl.value
  if (!el) return
  // the full content width, as if the rail were closed
  const full = el.clientWidth + (selected.value ? railWidth.value : 0) - CONTENT_PAD
  const n = Math.floor((full + TILE_GAP) / (TILE_MIN + TILE_GAP))
  if (n < 4) return // too narrow to give two columns away; keep the last width
  const col = (full - (n - 1) * TILE_GAP) / n
  railWidth.value = Math.round(2 * col + 2 * TILE_GAP)
}
onMounted(() => {
  ro = new ResizeObserver(() => {
    if (!selected.value) measureRail()
  })
  if (contentEl.value) ro.observe(contentEl.value)
  measureRail()
})
onBeforeUnmount(() => ro?.disconnect())

const selected = computed(() =>
  selectedIds.value.length === 1
    ? (assets.value.find((a) => a.id === selectedIds.value[0]) ?? null)
    : null,
)
const batch = computed(() => selectedIds.value.length >= 2)
const version = ref(0)

function onSelect(asset: MediaAsset, additive: boolean) {
  if (additive) {
    selectedIds.value = selectedIds.value.includes(asset.id)
      ? selectedIds.value.filter((id) => id !== asset.id)
      : [...selectedIds.value, asset.id]
  } else {
    selectedIds.value = [asset.id]
  }
}
const clearSelection = () => (selectedIds.value = [])

function onPick(asset: MediaAsset) {
  if (selecting.value) pickAndClose(asset)
}

// full "Parent / Child" folder paths for the move-to menus
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
const folderTargets = computed(() =>
  [...folders.value.map((f) => ({ id: f.id, label: folderPath(f.id) }))].sort((a, b) =>
    a.label.localeCompare(b.label),
  ),
)

async function batchMove(folderId: string | null) {
  for (const id of [...selectedIds.value]) {
    await updateAsset(id, { folderId }).catch((e) => (uploadError.value = errMsg(e)))
  }
}
async function batchDelete() {
  const n = selectedIds.value.length
  const ok = await confirm({
    title: 'Delete files',
    message: `Delete ${n} file${n === 1 ? '' : 's'}? This cannot be undone.`,
  })
  if (!ok) return
  for (const id of [...selectedIds.value]) {
    await removeAsset(id).catch((e) => (uploadError.value = errMsg(e)))
  }
  clearSelection()
}

// ----- upload (file input + drag-and-drop share one path) -----
const uploadInput = ref<HTMLInputElement>()
const uploadProgress = ref<string | null>(null)
const uploadError = ref<string | null>(null)

async function uploadFiles(files: File[], folderId?: string) {
  if (!files.length || uploadProgress.value) return
  uploadError.value = null
  // no explicit target → the folder currently open
  folderId ??= currentFolderId.value ?? undefined
  for (const [i, file] of files.entries()) {
    uploadProgress.value = `${i + 1}/${files.length}`
    try {
      const asset = await upload(file, folderId)
      selectedIds.value = [asset.id]
    } catch (err) {
      uploadError.value = err instanceof Error ? err.message : 'upload failed'
    }
  }
  uploadProgress.value = null
}

function onUploadFiles(e: Event) {
  const files = [...((e.target as HTMLInputElement).files ?? [])]
  ;(e.target as HTMLInputElement).value = ''
  void uploadFiles(files)
}

// OS file drop overlay (only for OS file drags, not tile/folder moves)
const dragDepth = ref(0)
const dragActive = computed(() => dragDepth.value > 0)
const isFileDrag = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
function onDragEnter(e: DragEvent) {
  if (isFileDrag(e)) dragDepth.value++
}
function onDragLeave(e: DragEvent) {
  if (isFileDrag(e)) dragDepth.value = Math.max(0, dragDepth.value - 1)
}
function onDrop(e: DragEvent) {
  dragDepth.value = 0
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.length) void uploadFiles(files)
}

// ----- MediaGrid events -----
function openFolder(folder: MediaFolder) {
  currentFolderId.value = folder.id
}
async function onMoveAsset(assetId: string, folderId: string | null) {
  // dragging one of several selected items moves the whole selection
  const ids =
    selectedIds.value.includes(assetId) && selectedIds.value.length > 1
      ? [...selectedIds.value]
      : [assetId]
  for (const id of ids) {
    await updateAsset(id, { folderId }).catch((e) => (uploadError.value = errMsg(e)))
  }
}
async function onMoveFolder(folderId: string, targetId: string | null) {
  await moveFolder(folderId, targetId).catch((e) => (uploadError.value = errMsg(e)))
}
function onRenameFolder(id: string, name: string) {
  void renameFolder(id, name).catch((e) => (uploadError.value = errMsg(e)))
}
function onRenameAsset(id: string, name: string) {
  void updateAsset(id, { name }).catch((e) => (uploadError.value = errMsg(e)))
}
/** the grid has no <a>, so the download is triggered programmatically */
function downloadAsset(asset: MediaAsset) {
  const a = document.createElement('a')
  a.href = `${mediaUrl(asset)}?download=1`
  a.download = asset.filename
  a.click()
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'action failed')

// ----- create folder (at the current level, opens straight into rename) -----
const freshFolderId = ref<string | null>(null)
async function createFolderHere() {
  try {
    const f = await createFolder('New folder', currentFolderId.value ?? undefined)
    freshFolderId.value = f.id
  } catch (e) {
    uploadError.value = errMsg(e)
  }
}

// ----- breadcrumb drop targets (move up to an ancestor / root) -----
function onCrumbDrop(e: DragEvent, folderId: string | null) {
  const assetId = e.dataTransfer?.getData('application/x-guano-asset')
  if (assetId) return void onMoveAsset(assetId, folderId)
  const fId = e.dataTransfer?.getData('application/x-guano-folder')
  if (fId && fId !== folderId) void onMoveFolder(fId, folderId)
}

// ----- delete (asset / folder) -----
async function requestDelete(asset: MediaAsset) {
  let message = `Delete “${asset.name}”? This cannot be undone.`
  try {
    const used = await usage(asset.id)
    if (used.total > 0) {
      const branches = used.branches.length
      message =
        `“${asset.name}” is used in ${used.total} place${used.total === 1 ? '' : 's'}` +
        (branches > 1 ? ` across ${branches} branches` : '') +
        '. Elements using it will appear broken after deletion.'
    }
  } catch {
    /* ignore */
  }
  if (!(await confirm({ title: 'Delete file', message }))) return
  await removeAsset(asset.id)
  selectedIds.value = selectedIds.value.filter((id) => id !== asset.id)
}

async function requestFolderDelete(folder: MediaFolder) {
  const ok = await confirm({
    title: 'Delete folder',
    message: `Delete “${folder.name}”? Its files and any subfolders move up one level.`,
  })
  if (!ok) return
  const up = folder.parentId ?? null
  await removeFolder(folder.id).catch((e) => (uploadError.value = errMsg(e)))
  if (currentFolderId.value === folder.id) currentFolderId.value = up
}

</script>

<template>
  <ModalHost size="full" @close="emit('close')">
    <div class="flex h-full flex-col">
      <!-- header: [icon] [title] ——— [search] [close] -->
      <div class="flex shrink-0 items-center gap-2 border-b border-input py-2.5 pr-1.5 pl-4">
        <ImageIcon class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-xs font-medium">{{ selecting ? 'Choose a file' : 'Media library' }}</span>
        <div class="flex-1" />
        <div class="relative w-64">
          <Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="query"
            type="text"
            spellcheck="false"
            placeholder="Search media…"
            class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <ButtonUI variant="icon" size="sm" :icon="X" class="w-7 text-muted-foreground" @click="emit('close')" />
      </div>

      <!-- toolbar: type chips ——— filter · view · new folder · upload. The right
           cluster is one family: h-9, rounded-xl, text-xs, 3.5 icons -->
      <div class="flex shrink-0 items-center gap-2 border-b border-input px-4 py-2">
        <div class="flex min-w-0 flex-wrap items-center gap-1">
          <ButtonUI
            size="xs"
            :variant="type === 'all' ? 'default' : 'ghost'"
            class="text-muted-foreground"
            :class="type === 'all' && '!text-primary-foreground'"
            @click="type = 'all'"
          >
            All
          </ButtonUI>
          <ButtonUI
            v-for="k in visibleKinds"
            :key="k"
            size="xs"
            :variant="type === k ? 'default' : 'ghost'"
            class="text-muted-foreground"
            :class="type === k && '!text-primary-foreground'"
            @click="type = k"
          >
            {{ KIND_LABELS[k] }}
          </ButtonUI>
        </div>

        <div class="flex-1" />

        <!-- filter & sort: a small form, not a list of menu items -->
        <MenuUI
          width="w-64"
          trigger-class="flex h-9 items-center gap-2 rounded-xl border border-accent px-3 text-xs font-medium outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <template #trigger>
            <SlidersHorizontal class="size-3.5" />
            Filter
            <span
              v-if="activeFilters"
              class="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground"
            >{{ activeFilters }}</span>
          </template>
          <template #default>
            <div class="flex flex-col gap-2 p-2" @click.stop>
              <div class="flex flex-col gap-1">
                <span class="section-label">Sort by</span>
                <div class="flex items-center gap-1">
                  <div class="min-w-0 flex-1"><SelectUI v-model="sortKey" :options="SORT_OPTIONS" /></div>
                  <ButtonUI
                    variant="outline"
                    size="xs"
                    :icon="sortDir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow"
                    :tooltip="sortDir === 'asc' ? 'Ascending' : 'Descending'"
                    class="!h-7 w-7 shrink-0 text-muted-foreground"
                    @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
                  />
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <span class="section-label">File size</span>
                <SelectUI v-model="sizeFilter" :options="SIZE_OPTIONS" />
              </div>
              <div class="flex flex-col gap-1">
                <span class="section-label">Uploaded</span>
                <SelectUI v-model="dateFilter" :options="DATE_OPTIONS" />
              </div>
              <template v-if="filtersDirty">
                <div class="h-px bg-input" />
                <ButtonUI variant="ghost" size="sm" class="justify-center text-muted-foreground" @click="resetFilters">
                  Reset
                </ButtonUI>
              </template>
            </div>
          </template>
        </MenuUI>

        <!-- view switch: a segmented control — a recessed track with the
             active segment raised, the same height as the buttons beside it -->
        <div
          role="radiogroup"
          aria-label="View"
          class="flex h-9 shrink-0 items-center gap-0.5 rounded-xl bg-input p-1"
        >
          <button
            v-for="opt in VIEW_OPTIONS"
            :key="opt.value"
            v-tooltip="opt.label"
            type="button"
            role="radio"
            :aria-checked="view === opt.value"
            class="flex h-7 w-8 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent [&_svg]:size-3.5"
            :class="
              view === opt.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="view = opt.value"
          >
            <component :is="opt.icon" />
          </button>
        </div>
        <ButtonUI variant="outline" size="sm" :icon="FolderPlus" class="shrink-0" @click="createFolderHere">
          New folder
        </ButtonUI>
        <ButtonUI size="sm" :icon="Upload" :disabled="!!uploadProgress" @click="uploadInput?.click()">
          {{ uploadProgress ? `Uploading ${uploadProgress}…` : 'Upload' }}
        </ButtonUI>
        <input
          ref="uploadInput"
          type="file"
          multiple
          :accept="acceptFor(selectAccept)"
          class="hidden"
          @change="onUploadFiles"
        />
      </div>

      <!-- errors get their own line so they can't distort the toolbar -->
      <div
        v-if="uploadError"
        class="flex shrink-0 items-center gap-2 border-b border-input px-4 py-1.5 text-xs text-danger"
      >
        <span class="min-w-0 flex-1 truncate">{{ uploadError }}</span>
        <ButtonUI variant="icon" size="xs" :icon="X" class="w-5" @click="uploadError = null" />
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- content -->
        <div
          ref="contentEl"
          class="custom-scrollbar relative min-w-0 flex-1 overflow-y-auto p-4"
          style="scrollbar-gutter: stable"
          @click.self="clearSelection"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <!-- breadcrumbs (browse mode only) -->
          <div v-if="!flatMode" class="mb-3 flex items-center gap-1 text-xs">
            <button
              type="button"
              class="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent/30"
              @click="currentFolderId = null"
              @dragover.prevent
              @drop.prevent="onCrumbDrop($event, null)"
            >
              Library
            </button>
            <template v-for="f in breadcrumb" :key="f.id">
              <span class="text-muted-foreground/50">/</span>
              <button
                type="button"
                class="rounded px-1.5 py-0.5 hover:bg-accent/30"
                :class="f.id === currentFolderId ? 'font-medium' : 'text-muted-foreground'"
                @click="currentFolderId = f.id"
                @dragover.prevent
                @drop.prevent="onCrumbDrop($event, f.id)"
              >
                {{ f.name }}
              </button>
            </template>
          </div>

          <div
            v-if="dragActive"
            class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10"
          >
            <p class="text-sm font-medium">Drop to upload</p>
          </div>

          <div v-if="loadError" class="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <p>{{ loadError }}</p>
            <ButtonUI variant="outline" size="sm" @click="loadMedia().catch(() => {})">Retry</ButtonUI>
          </div>
          <div
            v-else-if="loaded && isEmpty"
            class="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground"
          >
            <p class="text-sm">{{ flatMode ? 'No matches.' : 'Nothing here yet.' }}</p>
            <p v-if="!flatMode" class="text-xs">Upload files or create a folder.</p>
          </div>
          <MediaGrid
            v-else
            :folders="visibleFolders"
            :assets="visibleAssets"
            :selected-ids="selectedIds"
            :version="version"
            :view="view"
            :start-rename-id="freshFolderId"
            :folder-counts="folderCounts"
            :folder-targets="folderTargets"
            @select="onSelect"
            @bgclick="clearSelection"
            @pick="onPick"
            @open="openFolder"
            @move-asset="onMoveAsset"
            @move-folder="onMoveFolder"
            @upload-to="(id, files) => uploadFiles(files, id)"
            @rename="onRenameFolder"
            @remove="requestFolderDelete"
            @rename-asset="onRenameAsset"
            @download="downloadAsset"
            @remove-asset="requestDelete"
          />

          <!-- batch actions: a pill floating over the grid. sticky (not absolute)
               so it stays put while the grid scrolls under it -->
          <div
            v-if="batch"
            class="sticky bottom-0 z-20 mx-auto mt-4 flex w-fit items-center gap-1 rounded-2xl border border-input bg-background p-1.5 shadow-xl"
          >
            <span class="px-2 text-xs font-medium">{{ selectedIds.length }} selected</span>
            <MenuUI
              side="top"
              width="w-56"
              trigger-class="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <template #trigger>
                <FolderInput class="size-3.5" /> Move to
              </template>
              <template #default="{ close }">
                <div class="custom-scrollbar flex max-h-64 flex-col overflow-y-auto">
                  <button type="button" class="menu-item" @click="(batchMove(null), close())">
                    <FolderInput class="size-3.5" /> Library (root)
                  </button>
                  <button
                    v-for="t in folderTargets"
                    :key="t.id"
                    type="button"
                    class="menu-item"
                    @click="(batchMove(t.id), close())"
                  >
                    <FolderIcon class="size-3.5 shrink-0" />
                    <span class="truncate">{{ t.label }}</span>
                  </button>
                </div>
              </template>
            </MenuUI>
            <ButtonUI variant="ghost" size="sm" :icon="Trash2" class="text-danger" @click="batchDelete">
              Delete
            </ButtonUI>
            <div class="mx-0.5 h-5 w-px bg-input" />
            <ButtonUI
              variant="icon"
              size="sm"
              :icon="X"
              tooltip="Clear selection"
              class="w-7 text-muted-foreground"
              @click="clearSelection"
            />
          </div>
        </div>

        <!-- rail: single-item details. Its width is exactly two grid columns
             (plus their gaps), so opening it drops two columns and every
             remaining tile keeps the width it had — see railWidth. -->
        <div
          v-if="selected"
          class="flex shrink-0 flex-col border-l border-input"
          :style="{ width: `${railWidth}px` }"
        >
          <MediaDetails
            :asset="selected"
            :version="version"
            @replaced="version++"
            @delete="requestDelete(selected)"
          />
        </div>
      </div>

      <!-- select mode: confirm the chosen file -->
      <div
        v-if="selecting && selected"
        class="flex shrink-0 items-center gap-3 border-t border-input px-4 py-2.5"
      >
        <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/60">
          <img
            v-if="selected.kind === 'image'"
            :src="`${thumbUrl(selected)}?v=${version}`"
            :alt="selected.name"
            class="size-full object-cover"
          />
          <ImageIcon v-else class="size-4 text-muted-foreground" />
        </span>
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-xs font-medium">{{ selected.name }}</span>
          <span class="truncate text-[10px] text-muted-foreground">{{ formatBytes(selected.size) }}</span>
        </span>
        <div class="flex-1" />
        <ButtonUI size="sm" :icon="Check" @click="pickAndClose(selected)">Use this file</ButtonUI>
      </div>
    </div>
  </ModalHost>
</template>
