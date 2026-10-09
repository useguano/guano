<script lang="ts">
import { defineAsyncComponent, ref } from 'vue'

const expanded = ref<Record<string, boolean>>({})
</script>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  Plus, Copy, Trash2, Settings, Languages, ChevronDown, ChevronRight, Check,
  House, SquarePen,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import DrawerShell from './DrawerShell.vue'
import PageSettingsEditor, { type SettingsTarget } from './PageSettingsEditor.vue'
import CollectionSettingsEditor from './CollectionSettingsEditor.vue'
import LayersPane from '@/components/editor/layers/LayersPane.vue'
import { usePage } from '@/composables/usePage'
import { useProject } from '@/composables/useProject'
import { useCollections } from '@/composables/useCollections'
import { useHeaderNav } from '@/composables/useHeaderNav'
import { useLocale } from '@/composables/useLocale'
import { useLocaleQuickAdd } from '@/composables/useLocaleQuickAdd'
import { useModal } from '@/composables/useModal'
import { useAuth } from '@/composables/useAuth'
import { useDrawerEscape } from '@/composables/useDrawerEscape'
import { walkNodes } from '@/lib/tree'
import type { Collection, CollectionEntry, ElementNode, Page } from '@/types/editor'

const CreateCollectionModal = defineAsyncComponent(() => import('@/components/shared/CreateCollectionModal.vue'))

const { homePage, duplicatePage, removePage } = usePage()
const {
  collections, duplicateEntry, removeEntry,
  duplicateCollection, removeCollection, openEntry, activeEntryId,
} = useCollections()
const { regularPages, isActivePage, openPage, createPage, newEntry } = useHeaderNav()
const { project } = useProject()
const { locales, activeLocale, defaultLocale, setActiveLocale, deleteLocale } = useLocale()
const {
  addingLocale, newLocale, newLocaleInput,
  startAddLocale, confirmAddLocale,
} = useLocaleQuickAdd()
const { openModal, confirm } = useModal()
const { canBuild, canEditContent } = useAuth()

const settingsTarget = ref<SettingsTarget | null>(null)
const layersOpen = ref(false)
const collectionSettingsId = ref<string | null>(null)
const detailOpen = computed(
  () => !!settingsTarget.value || layersOpen.value || !!collectionSettingsId.value,
)
function closeDetail() {
  settingsTarget.value = null
  layersOpen.value = false
  collectionSettingsId.value = null
}

function selectPage(pageId: string) {
  if (canBuild.value) {
    editLayers(pageId)
    return
  }
  openPage(pageId)
}

function editLayers(pageId: string) {
  openPage(pageId)
  closeDetail()
  layersOpen.value = true
}
const query = ref('')

onMounted(() => {
  if (!activeEntryId.value) return
  const owner = collections.value.find((c) =>
    c.entries.some((e) => e.id === activeEntryId.value),
  )
  if (owner) expanded.value[owner.id] = true
})

const needle = computed(() => query.value.trim().toLowerCase())
const searching = computed(() => needle.value.length > 0)
const matches = (name: string) => name.toLowerCase().includes(needle.value)

const visiblePages = computed<Page[]>(() =>
  searching.value ? regularPages.value.filter((p) => matches(p.name)) : regularPages.value,
)

const visibleCollections = computed<{ collection: Collection; entries: CollectionEntry[] }[]>(() => {
  if (!searching.value) return collections.value.map((c) => ({ collection: c, entries: c.entries }))
  const out: { collection: Collection; entries: CollectionEntry[] }[] = []
  for (const collection of collections.value) {
    if (matches(collection.name)) {
      out.push({ collection, entries: collection.entries })
      continue
    }
    const entries = collection.entries.filter((e) => matches(e.name))
    if (entries.length) out.push({ collection, entries })
  }
  return out
})

const noResults = computed(
  () => searching.value && !visiblePages.value.length && !visibleCollections.value.length,
)

const isExpanded = (id: string) => searching.value || expanded.value[id] === true
const toggleCollection = (id: string) => {
  if (searching.value) return
  expanded.value[id] = !expanded.value[id]
}

const isDraft = (status?: string) => status === 'draft'

function openEntryDetail(collection: Collection, entryId: string) {
  openEntry(collection, entryId)
  if (!canEditContent.value) return
  settingsTarget.value = { kind: 'entry', collectionId: collection.id, entryId }
}

function addItem(collection: Collection) {
  const entry = newEntry(collection)
  expanded.value[collection.id] = true
  settingsTarget.value = { kind: 'entry', collectionId: collection.id, entryId: entry.id }
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()
function localeName(code: string): string {
  try {
    return languageNames?.of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const localeStats = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  const bump = (code: string) => (counts[code] = (counts[code] ?? 0) + 1)
  const countNode = (node: ElementNode) => {
    if (!node.locales) return
    for (const [code, v] of Object.entries(node.locales)) {
      if (v && (v.content != null || v.src != null)) bump(code)
    }
  }
  for (const page of project.value.pages) walkNodes(page.elements, countNode)
  for (const comp of project.value.components) walkNodes([comp.root], countNode)
  for (const collection of project.value.collections) {
    for (const entry of collection.entries) {
      if (!entry.locales) continue
      for (const [code, fields] of Object.entries(entry.locales)) {
        for (const val of Object.values(fields)) if (val != null && val !== '') bump(code)
      }
    }
  }
  return counts
})

function localeMeta(code: string): string {
  const parts = [code.toUpperCase()]
  if (code === defaultLocale.value) {
    parts.push('Default', 'source content')
  } else {
    const n = localeStats.value[code] ?? 0
    parts.push(n ? `${n} translated` : 'Not translated')
  }
  return parts.join(' · ')
}

function pickLocale(code: string, close: () => void) {
  setActiveLocale(code)
  addingLocale.value = false
  close()
}

async function confirmDeletePage(page: Page) {
  const ok = await confirm({
    title: 'Delete page',
    message: `Delete “${page.name}”? This can’t be undone.`,
    confirmLabel: 'Delete',
  })
  if (ok) removePage(page.id)
}

async function confirmDeleteCollection(collection: Collection) {
  const n = collection.entries.length
  const ok = await confirm({
    title: 'Delete collection',
    message: `Delete the collection “${collection.name}”? Its template page and all ${n} ${n === 1 ? 'entry' : 'entries'} will be permanently deleted.`,
  })
  if (ok) removeCollection(collection)
}

async function confirmDeleteEntry(collection: Collection, entry: CollectionEntry) {
  const ok = await confirm({
    title: 'Delete entry',
    message: `Delete “${entry.name}” from ${collection.name}? This can’t be undone.`,
  })
  if (ok) removeEntry(collection, entry.id)
}

async function confirmDeleteLocale(loc: string) {
  const ok = await confirm({
    title: 'Delete locale',
    message: `Delete ${loc.toUpperCase()} and all of its translated content? The default locale keeps its content.`,
  })
  if (ok) deleteLocale(loc)
}

const shell = ref<InstanceType<typeof DrawerShell>>()
const panel = computed(() => shell.value?.el)

useDrawerEscape(panel, {
  canPeel: () =>
    searching.value || (!layersOpen.value && (!!settingsTarget.value || !!collectionSettingsId.value)),
  peel: () => {
    if (searching.value) query.value = ''
    else closeDetail()
  },
})
</script>

<template>
  <DrawerShell ref="shell" v-model:query="query" :detail="detailOpen" placeholder="Search pages, items…">
    <template #detail>
      <LayersPane v-if="layersOpen" @back="closeDetail" />
      <CollectionSettingsEditor
        v-else-if="collectionSettingsId"
        :collection-id="collectionSettingsId"
        @back="closeDetail"
      />
      <PageSettingsEditor
        v-else-if="settingsTarget"
        :target="settingsTarget"
        @back="closeDetail"
      />
    </template>

    <div class="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto pb-10">
      <div v-if="visiblePages.length || !searching" class="flex items-center gap-1 px-2.5 pt-2 pb-1">
        <span class="flex-1 section-label">
          Pages
        </span>
        <ButtonUI
          v-if="canEditContent"
          variant="icon" size="xs" :icon="Plus"
          tooltip="New page" tooltip-side="right"
          class="w-5 text-muted-foreground"
          @click.stop="createPage"
        />
      </div>
      <div
        v-for="page in visiblePages" :key="page.id"
        :data-page-row="page.name"
        class="group/row mx-1 flex h-7 items-center rounded-md pr-0.5 pl-1.5"
        :class="isActivePage(page.id) ? 'bg-accent/25' : 'hover:bg-accent/15'"
      >
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none px-0.5"
          @click="selectPage(page.id)"
        >
          <House v-if="page.id === homePage.id" class="size-3 shrink-0 text-muted-foreground" />
          <span
            class="truncate text-xs"
            :class="isActivePage(page.id) ? 'font-medium' : 'text-muted-foreground'"
          >{{ page.name }}</span>
          <span
            v-if="isDraft(page.status)"
            v-tooltip="'Draft — not published'"
            class="size-1.5 shrink-0 rounded-full bg-pending"
          />
        </button>
        <ButtonUI
          v-if="canBuild"
          variant="icon" size="xs" :icon="SquarePen" tooltip="Edit layers"
          class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
          @click.stop="editLayers(page.id)"
        />
        <MenuUI
          v-if="canEditContent"
          width="w-40"
          class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
          trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <template #default="{ close }">
            <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(settingsTarget = { kind: 'page', pageId: page.id }, close())">
              <Settings class="size-3.5" /> Settings
            </button>
            <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicatePage(page.id), close())">
              <Copy class="size-3.5" /> Duplicate
            </button>
            <template v-if="page.id !== homePage.id">
              <div class="mx-1 my-1 h-px bg-input" />
              <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30 text-danger" @click="(confirmDeletePage(page), close())">
                <Trash2 class="size-3.5" /> Delete
              </button>
            </template>
          </template>
        </MenuUI>
      </div>

      <div v-if="visibleCollections.length || !searching" class="flex items-center gap-1 px-2.5 pt-4 pb-1">
        <span class="flex-1 section-label">
          Collections
        </span>
        <ButtonUI
          v-if="canEditContent"
          variant="icon" size="xs" :icon="Plus"
          tooltip="New collection" tooltip-side="right"
          class="w-5 text-muted-foreground"
          @click.stop="openModal(CreateCollectionModal)"
        />
      </div>
      <p v-if="!collections.length" class="px-2.5 py-1 text-[10px] text-muted-foreground">
        No collections yet.
      </p>

      <div v-for="{ collection, entries } in visibleCollections" :key="collection.id">
        <div
          :data-collection-row="collection.name"
          class="group/row mx-1 flex h-7 items-center rounded-md pr-0.5 pl-1 hover:bg-accent/15"
        >
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none"
            @click="toggleCollection(collection.id)"
          >
            <ChevronRight
              class="size-3 shrink-0 text-muted-foreground transition-transform"
              :class="isExpanded(collection.id) && 'rotate-90'"
            />
            <span class="truncate text-xs font-medium">{{ collection.name }}</span>
            <span class="shrink-0 text-[10px] text-muted-foreground">{{ collection.entries.length }}</span>
          </button>

          <ButtonUI
            v-if="canBuild && collection.templatePageId"
            variant="icon" size="xs" :icon="SquarePen" tooltip="Edit template layers"
            class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
            @click.stop="editLayers(collection.templatePageId)"
          />
          <ButtonUI
            v-if="canEditContent"
            variant="icon" size="xs" :icon="Plus" tooltip="Add item"
            class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
            @click.stop="addItem(collection)"
          />
          <MenuUI
            v-if="canEditContent"
            width="w-44"
            class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
            trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <template #default="{ close }">
              <button
                type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
                @click="(collectionSettingsId = collection.id, close())"
              >
                <Settings class="size-3.5" /> Settings
              </button>
              <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicateCollection(collection), close())">
                <Copy class="size-3.5" /> Duplicate
              </button>
              <div class="mx-1 my-1 h-px bg-input" />
              <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30 text-danger" @click="(confirmDeleteCollection(collection), close())">
                <Trash2 class="size-3.5" /> Delete
              </button>
            </template>
          </MenuUI>
        </div>

        <div v-if="isExpanded(collection.id)" class="mt-0.5 mb-1 ml-3.5 border-l border-input pl-1">
          <p v-if="!entries.length" class="px-1.5 py-1 text-[10px] text-muted-foreground">
            No items yet.
          </p>
          <div
            v-for="entry in entries" :key="entry.id"
            class="group/row mr-1 flex h-7 items-center rounded-md pr-0.5 pl-1.5"
            :class="activeEntryId === entry.id ? 'bg-accent/25' : 'hover:bg-accent/15'"
          >
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
              @click="openEntryDetail(collection, entry.id)"
            >
              <span
                class="truncate text-xs"
                :class="activeEntryId === entry.id ? 'font-medium' : 'text-muted-foreground'"
              >{{ entry.name }}</span>
              <span
                v-if="isDraft(entry.status)"
                v-tooltip="'Draft — not published'"
                class="size-1.5 shrink-0 rounded-full bg-pending"
              />
            </button>
            <MenuUI
              v-if="canEditContent"
              width="w-40"
              class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
              trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
            >
              <template #default="{ close }">
                <button
                  type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
                  @click="(settingsTarget = { kind: 'entry', collectionId: collection.id, entryId: entry.id }, close())"
                >
                  <Settings class="size-3.5" /> Settings
                </button>
                <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicateEntry(collection, entry.id), close())">
                  <Copy class="size-3.5" /> Duplicate
                </button>
                <div class="mx-1 my-1 h-px bg-input" />
                <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30 text-danger" @click="(confirmDeleteEntry(collection, entry), close())">
                  <Trash2 class="size-3.5" /> Delete
                </button>
              </template>
            </MenuUI>
          </div>
        </div>
      </div>

      <p v-if="noResults" class="px-2 py-6 text-center text-xs text-muted-foreground">
        No results for “{{ query.trim() }}”.
      </p>
    </div>

    <template #footer>
    <div class="shrink-0 border-t border-input p-1">
      <MenuUI
        side="top"
        width="w-[15rem]"
        trigger-class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <template #trigger>
          <Languages class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-xs font-medium">{{ localeName(activeLocale) }}</span>
            <span class="truncate text-[10px] text-muted-foreground">{{ localeMeta(activeLocale) }}</span>
          </span>
          <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
        </template>
        <template #default="{ close }">
          <div v-for="loc in locales" :key="loc" class="group/loc flex items-center">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
              @click="pickLocale(loc, close)"
            >
              <Check class="mt-0.5 size-3 shrink-0" :class="loc === activeLocale ? 'opacity-100' : 'opacity-0'" />
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-xs font-medium">{{ localeName(loc) }}</span>
                <span class="truncate text-[10px] text-muted-foreground">{{ localeMeta(loc) }}</span>
              </span>
            </button>
            <ButtonUI
              v-if="loc !== defaultLocale && canEditContent"
              variant="icon" size="sm" :icon="Trash2" tooltip="Delete locale"
              class="w-7 shrink-0 text-muted-foreground opacity-0 group-hover/loc:opacity-100 hover:text-danger"
              @click.stop="confirmDeleteLocale(loc)"
            />
          </div>
          <div v-if="canEditContent" class="mx-1 my-1 h-px bg-input" />
          <ButtonUI
            v-if="canEditContent && !addingLocale"
            variant="ghost" size="sm" :icon="Plus"
            class="w-full justify-start text-muted-foreground"
            @click.stop="startAddLocale"
          >
            Add locale…
          </ButtonUI>
          <input
            v-else-if="canEditContent"
            ref="newLocaleInput"
            v-model="newLocale"
            class="mx-1 my-0.5 w-[calc(100%-0.5rem)] rounded border border-input bg-transparent px-2 py-1 text-xs text-foreground outline-none"
            placeholder="e.g. fr"
            @click.stop
            @keydown.enter.prevent="confirmAddLocale(() => {})"
            @keydown.esc.stop.prevent="addingLocale = false"
          />
        </template>
      </MenuUI>
    </div>
    </template>
  </DrawerShell>
</template>
