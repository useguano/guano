<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  Check, Download, FileText, Film, FolderInput, Folder as FolderIcon, Music, Pencil, Trash2, Type,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import RenameModal from '@/components/modal/RenameModal.vue'
import { useModal } from '@/composables/useModal'
import MenuUI from '@/components/ui/MenuUI.vue'
import type { MediaAsset, MediaFolder, MediaKind } from '@/types/media'
import { useMedia } from '@/composables/useMedia'
import { formatBytes } from '@/lib/media'

const props = defineProps<{
  folders: MediaFolder[]
  assets: MediaAsset[]
  selectedIds: string[]
  version: number
  view: 'grid' | 'list'
  startRenameId?: string | null
  folderCounts: Record<string, number>
  folderTargets: { id: string; label: string }[]
}>()

const emit = defineEmits<{
  select: [asset: MediaAsset, additive: boolean]
  bgclick: []
  pick: [asset: MediaAsset]
  open: [folder: MediaFolder]
  moveAsset: [assetId: string, folderId: string | null]
  moveFolder: [folderId: string, targetId: string | null]
  uploadTo: [folderId: string, files: File[]]
  rename: [id: string, name: string]
  remove: [folder: MediaFolder]
  renameAsset: [id: string, name: string]
  download: [asset: MediaAsset]
  removeAsset: [asset: MediaAsset]
}>()

const { thumbUrl, mediaUrl } = useMedia()

const ASSET_MIME = 'application/x-guano-asset'
const FOLDER_MIME = 'application/x-guano-folder'

const draggingId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

const KIND_ICONS: Partial<Record<MediaKind, Component>> = {
  video: Film,
  audio: Music,
  document: FileText,
  font: Type,
}
const previewSrc = (asset: MediaAsset) =>
  asset.kind === 'image' ? `${thumbUrl(asset)}?v=${props.version}` : null
const isSelected = (id: string) => props.selectedIds.includes(id)
const folderCount = (id: string) => props.folderCounts[id] ?? 0

const KEBAB_TRIGGER =
  'flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent'
const KEBAB_ON_TILE =
  'flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent'

function setCardImage(e: DragEvent) {
  const el = (e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  e.dataTransfer?.setDragImage(el, e.clientX - r.left, e.clientY - r.top)
}
function onAssetDragStart(e: DragEvent, asset: MediaAsset) {
  e.dataTransfer?.setData(ASSET_MIME, asset.id)
  setCardImage(e)
  draggingId.value = asset.id
}
function onFolderDragStart(e: DragEvent, folder: MediaFolder) {
  e.dataTransfer?.setData(FOLDER_MIME, folder.id)
  setCardImage(e)
  draggingId.value = folder.id
}
function onDragEnd() {
  draggingId.value = null
  dropTargetId.value = null
}

function onFolderDragOver(e: DragEvent, folder: MediaFolder) {
  if (draggingId.value === folder.id) return
  e.preventDefault()
  dropTargetId.value = folder.id
}
function onFolderDrop(e: DragEvent, folder: MediaFolder) {
  dropTargetId.value = null
  const assetId = e.dataTransfer?.getData(ASSET_MIME)
  if (assetId) return emit('moveAsset', assetId, folder.id)
  const folderId = e.dataTransfer?.getData(FOLDER_MIME)
  if (folderId && folderId !== folder.id) return emit('moveFolder', folderId, folder.id)
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.length) emit('uploadTo', folder.id, files)
}

const { openModal } = useModal()
async function startRename(folder: MediaFolder) {
  const name = await openModal<string>(RenameModal, { title: 'Rename folder', value: folder.name, placeholder: 'Folder name' })
  if (name) emit('rename', folder.id, name)
}
async function startRenameAsset(asset: MediaAsset) {
  const name = await openModal<string>(RenameModal, { title: 'Rename file', value: asset.name, placeholder: 'File name' })
  if (name) emit('renameAsset', asset.id, name)
}
watch(
  () => props.startRenameId,
  (id) => {
    const folder = id ? props.folders.find((f) => f.id === id) : null
    if (folder) startRename(folder)
  },
)
</script>

<template>
  <div v-if="view === 'grid'" class="flex min-h-full flex-col gap-4" @click.self="emit('bgclick')">

    <div class="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3" @click.self="emit('bgclick')">
      <div
        v-for="folder in folders"
        :key="folder.id"
        data-card
        class="group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:bg-accent/20"
        :class="[
          draggingId === folder.id && 'opacity-40',
          dropTargetId === folder.id && 'bg-accent/30 ring-1 ring-accent',
        ]"
        @dragover="onFolderDragOver($event, folder)"
        @dragleave="dropTargetId = null"
        @drop.prevent="onFolderDrop($event, folder)"
      >
        <div class="absolute top-3 right-3 z-10">
          <MenuUI
            width="w-40"
            class="opacity-0 group-hover:opacity-100 data-[open]:opacity-100"
            :trigger-class="KEBAB_ON_TILE"
          >
            <template #default="{ close }">
              <button type="button" class="menu-item" @click="(startRename(folder), close())">
                <Pencil class="size-3.5" /> Rename
              </button>
              <div class="mx-1 my-1 h-px bg-input" />
              <button type="button" class="menu-item text-danger" @click="(emit('remove', folder), close())">
                <Trash2 class="size-3.5" /> Delete
              </button>
            </template>
          </MenuUI>
        </div>
        <div
          role="button"
          tabindex="0"
          draggable="true"
          class="flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-muted/60 outline-none"
          @click="emit('open', folder)"
          @keydown.enter="emit('open', folder)"
          @dragstart="onFolderDragStart($event, folder)"
          @dragend="onDragEnd"
        >
          <FolderIcon class="size-8 text-muted-foreground" />
        </div>
        <div class="flex flex-col px-0.5">
          <span class="truncate text-xs text-foreground">{{ folder.name }}</span>
          <span class="text-[10px] text-muted-foreground">
            {{ folderCount(folder.id) }} item{{ folderCount(folder.id) === 1 ? '' : 's' }}
          </span>
        </div>
      </div>

      <div
        v-for="asset in assets"
        :key="asset.id"
        data-card
        class="group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:bg-accent/20"
        :class="[isSelected(asset.id) && 'bg-accent/30 ring-1 ring-accent', draggingId === asset.id && 'opacity-40']"
      >
        <button
          type="button"
          class="absolute top-3 left-3 z-10 flex size-4 items-center justify-center rounded border bg-background/90 outline-none transition-opacity"
          :class="isSelected(asset.id) ? 'border-accent bg-accent/30 text-foreground opacity-100' : 'border-input opacity-0 group-hover:opacity-100'"
          @click.stop="emit('select', asset, true)"
        >
          <Check v-if="isSelected(asset.id)" class="size-3" />
        </button>

        <div class="absolute top-3 right-3 z-10">
        <MenuUI
          width="w-48"
          class="opacity-0 group-hover:opacity-100 data-[open]:opacity-100"
          :trigger-class="KEBAB_ON_TILE"
        >
          <template #default="{ close }">
            <button type="button" class="menu-item" @click="(startRenameAsset(asset), close())">
              <Pencil class="size-3.5" /> Rename
            </button>
            <button type="button" class="menu-item" @click="(emit('download', asset), close())">
              <Download class="size-3.5" /> Download
            </button>
            <div class="mx-1 my-1 h-px bg-input" />
            <p class="px-2 py-1 section-label">
              Move to
            </p>
            <div class="custom-scrollbar flex max-h-48 flex-col overflow-y-auto">
              <button type="button" class="menu-item" @click="(emit('moveAsset', asset.id, null), close())">
                <FolderInput class="size-3.5" /> Library (root)
              </button>
              <button
                v-for="t in folderTargets"
                :key="t.id"
                type="button"
                class="menu-item"
                @click="(emit('moveAsset', asset.id, t.id), close())"
              >
                <FolderIcon class="size-3.5 shrink-0" />
                <span class="truncate">{{ t.label }}</span>
              </button>
            </div>
            <div class="mx-1 my-1 h-px bg-input" />
            <button type="button" class="menu-item text-danger" @click="(emit('removeAsset', asset), close())">
              <Trash2 class="size-3.5" /> Delete
            </button>
          </template>
        </MenuUI>
        </div>
        <div
          role="button"
          tabindex="0"
          draggable="true"
          class="flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-muted/60"
          @click="emit('select', asset, $event.metaKey || $event.ctrlKey || $event.shiftKey)"
          @dblclick="emit('pick', asset)"
          @dragstart="onAssetDragStart($event, asset)"
          @dragend="onDragEnd"
        >
          <img
            v-if="previewSrc(asset)"
            :src="previewSrc(asset)!"
            :alt="asset.alt ?? asset.name"
            loading="lazy"
            class="size-full object-cover"
          />
          <video
            v-else-if="asset.kind === 'video'"
            :src="`${mediaUrl(asset)}?v=${version}`"
            preload="metadata"
            muted
            class="size-full object-cover"
          />
          <component :is="KIND_ICONS[asset.kind] ?? FileText" v-else class="size-8 text-muted-foreground" />
        </div>
        <div class="flex flex-col px-0.5">
          <span class="truncate text-xs text-foreground">{{ asset.name }}</span>
          <span class="text-[10px] text-muted-foreground">{{ formatBytes(asset.size) }}</span>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="flex min-h-full flex-col" @click.self="emit('bgclick')">
    <div
      v-for="folder in folders"
      :key="folder.id"
      class="group flex items-center gap-3 border-b border-input py-2"
      :class="[draggingId === folder.id && 'opacity-40', dropTargetId === folder.id && 'bg-accent/20']"
    >
      <span class="w-4 shrink-0" />
      <FolderIcon class="size-4 shrink-0 text-muted-foreground" />
      <button
        type="button"
        draggable="true"
        class="min-w-0 flex-1 truncate text-left text-xs font-medium outline-none"
        @click="emit('open', folder)"
        @dragstart="onFolderDragStart($event, folder)"
        @dragend="onDragEnd"
        @dragover="onFolderDragOver($event, folder)"
        @dragleave="dropTargetId = null"
        @drop.prevent="onFolderDrop($event, folder)"
      >
        {{ folder.name }}
      </button>
      <span class="w-16 shrink-0 text-[10px] text-muted-foreground">
        {{ folderCount(folder.id) }} item{{ folderCount(folder.id) === 1 ? '' : 's' }}
      </span>
      <span class="w-16 shrink-0" />
      <MenuUI
        width="w-40"
        class="shrink-0 opacity-0 group-hover:opacity-100 data-[open]:opacity-100"
        :trigger-class="KEBAB_TRIGGER"
      >
        <template #default="{ close }">
          <button type="button" class="menu-item" @click="(startRename(folder), close())">
            <Pencil class="size-3.5" /> Rename
          </button>
          <div class="mx-1 my-1 h-px bg-input" />
          <button type="button" class="menu-item text-danger" @click="(emit('remove', folder), close())">
            <Trash2 class="size-3.5" /> Delete
          </button>
        </template>
      </MenuUI>
    </div>

    <div
      v-for="asset in assets"
      :key="asset.id"
      class="group flex items-center gap-3 border-b border-input py-2 transition-colors hover:bg-accent/20"
      :class="[isSelected(asset.id) && 'bg-accent/30', draggingId === asset.id && 'opacity-40']"
    >
      <button
        type="button"
        class="flex size-4 shrink-0 items-center justify-center rounded border outline-none"
        :class="isSelected(asset.id) ? 'border-accent bg-accent/30 text-foreground' : 'border-input opacity-0 group-hover:opacity-100'"
        @click.stop="emit('select', asset, true)"
      >
        <Check v-if="isSelected(asset.id)" class="size-3" />
      </button>
      <button
        type="button"
        draggable="true"
        class="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
        @click="emit('select', asset, $event.metaKey || $event.ctrlKey || $event.shiftKey)"
        @dblclick="emit('pick', asset)"
        @dragstart="onAssetDragStart($event, asset)"
        @dragend="onDragEnd"
      >
        <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/60">
          <img v-if="previewSrc(asset)" :src="previewSrc(asset)!" :alt="asset.name" class="size-full object-cover" />
          <component :is="KIND_ICONS[asset.kind] ?? FileText" v-else class="size-4 text-muted-foreground" />
        </span>
        <span class="min-w-0 flex-1 truncate text-xs">{{ asset.name }}</span>
      </button>
      <span class="w-16 shrink-0 text-[10px] text-muted-foreground capitalize">{{ asset.kind }}</span>
      <span class="w-16 shrink-0 text-right text-[10px] text-muted-foreground">{{ formatBytes(asset.size) }}</span>
      <MenuUI
        width="w-48"
        class="shrink-0 opacity-0 group-hover:opacity-100 data-[open]:opacity-100"
        :trigger-class="KEBAB_TRIGGER"
      >
        <template #default="{ close }">
          <button type="button" class="menu-item" @click="(startRenameAsset(asset), close())">
            <Pencil class="size-3.5" /> Rename
          </button>
          <button type="button" class="menu-item" @click="(emit('download', asset), close())">
            <Download class="size-3.5" /> Download
          </button>
          <div class="mx-1 my-1 h-px bg-input" />
          <p class="px-2 py-1 section-label">
            Move to
          </p>
          <div class="custom-scrollbar flex max-h-48 flex-col overflow-y-auto">
            <button type="button" class="menu-item" @click="(emit('moveAsset', asset.id, null), close())">
              <FolderInput class="size-3.5" /> Library (root)
            </button>
            <button
              v-for="t in folderTargets"
              :key="t.id"
              type="button"
              class="menu-item"
              @click="(emit('moveAsset', asset.id, t.id), close())"
            >
              <FolderIcon class="size-3.5 shrink-0" />
              <span class="truncate">{{ t.label }}</span>
            </button>
          </div>
          <div class="mx-1 my-1 h-px bg-input" />
          <button type="button" class="menu-item text-danger" @click="(emit('removeAsset', asset), close())">
            <Trash2 class="size-3.5" /> Delete
          </button>
        </template>
      </MenuUI>
    </div>
  </div>
</template>
