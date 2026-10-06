<script lang="ts">
import { ref } from 'vue'

// expand state — module-level because the column unmounts when it is toggled
// off, and the tree should come back as the user left it. Groups default to
// open, components to closed. Components are keyed by the def's id.
const expanded = ref<Record<string, boolean>>({})
const openComponents = ref<Record<string, boolean>>({})
</script>

<script setup lang="ts">
// Components navigator toggled from the left rail — a docked column sharing
// the one track beside the rail with Pages. While it is open the canvas shows
// the components board, and this column is its index AND its layers: clicking
// a row brings that component's card into view, expanding one shows its
// element tree, editable in place. Inserting a component into a page happens
// on the page, from the ⌘E dock.
import { computed } from 'vue'
import { ChevronRight, Component as ComponentIcon, Copy, Settings, Trash2 } from 'lucide-vue-next'
import MenuUI from '@/components/ui/MenuUI.vue'
import DrawerShell from './DrawerShell.vue'
import ComponentSettingsEditor from './ComponentSettingsEditor.vue'
import LayerRow from '@/components/editor/layers/LayerRow.vue'
import { useLayerSurface } from '@/components/editor/layers/useLayerSurface'
import { useComponents } from '@/composables/useComponents'
import { UNCATEGORIZED, focusCard, useComponentBoard } from '@/composables/useComponentBoard'
import type { BoardCard } from '@/composables/useComponentBoard'
import { useDrawerEscape } from '@/composables/useDrawerEscape'
import { useModal } from '@/composables/useModal'
import { findNode } from '@/lib/tree'
import type { ComponentDef } from '@/types/editor'

const { duplicateComponent, usageOf, deleteComponent } = useComponents()
const { cards, activeCard } = useComponentBoard()
const { confirm } = useModal()

/** when set, the drawer swaps its list for that component's settings */
const settingsId = ref<string | null>(null)
const query = ref('')

// --- filtering ---
const needle = computed(() => query.value.trim().toLowerCase())
const searching = computed(() => needle.value.length > 0)
const matches = (name: string) => name.toLowerCase().includes(needle.value)

interface Group {
  key: string
  name: string
  cards: BoardCard[]
}

/** cards by category, in board order — a category whose own name matches the
 *  filter keeps all of its components */
function groupsOf(list: BoardCard[], prefix: string, sort: boolean): Group[] {
  const byCategory = new Map<string, BoardCard[]>()
  for (const card of list) {
    const keepAll = searching.value && matches(card.category)
    const hit = matches(card.def.name)
    if (searching.value && !keepAll && !hit) continue
    const group = byCategory.get(card.category)
    if (group) group.push(card)
    else byCategory.set(card.category, [card])
  }
  const groups = [...byCategory.entries()].map(([name, cards]) => ({
    key: `${prefix}${name}`,
    name,
    cards: sort ? [...cards].sort((a, b) => a.def.name.localeCompare(b.def.name)) : cards,
  }))
  if (!sort) return groups
  return groups.sort((a, b) => {
    if (a.name === UNCATEGORIZED) return 1
    if (b.name === UNCATEGORIZED) return -1
    return a.name.localeCompare(b.name)
  })
}

const sections = computed(() => [{ title: 'Project', groups: groupsOf(cards.value, 'own:', true) }])

const hasOwn = computed(() => cards.value.length > 0)
const noResults = computed(
  () => searching.value && sections.value.every((section) => !section.groups.length),
)

// while filtering every group is forced open (without touching the stored state)
const isExpanded = (key: string) => searching.value || expanded.value[key] !== false
const toggleGroup = (key: string) => {
  if (searching.value) return
  expanded.value[key] = expanded.value[key] === false
}

const isOpen = (def: ComponentDef) => openComponents.value[def.id] === true
const toggleComponent = (def: ComponentDef) => {
  openComponents.value[def.id] = !isOpen(def)
}

// --- the element trees of the expanded components ---

const surface = ref<HTMLElement>()
const { onKeydown } = useLayerSurface({
  surface,
  // what ↑/↓ walk: the children of every open component, in display order.
  // The component's own row stands for the root wrapper.
  roots: () =>
    sections.value
      .flatMap((section) => section.groups)
      .filter((group) => isExpanded(group.key))
      .flatMap((group) => group.cards)
      .filter((card) => isOpen(card.def))
      .flatMap((card) => card.def.root.children),
  // a master's nodes never reach a page's ref space
  canRename: () => false,
  // a selection made on the board opens the component it belongs to
  beforeReveal(id) {
    const owner = cards.value.find((c) => !!findNode(c.def.root.children, id))
    if (!owner) return
    openComponents.value[owner.def.id] = true
    expanded.value[`own:${owner.category}`] = true
  },
})

// --- row actions ---

async function confirmDelete(def: ComponentDef) {
  const used = usageOf(def.name)
  const ok = await confirm({
    title: 'Delete component',
    message: used.count
      ? `Delete “${def.name}”? Its ${used.count === 1 ? 'instance' : `${used.count} instances`} stay on the page as plain elements, keeping their look.`
      : `Delete “${def.name}”? It isn’t used on any page.`,
    confirmLabel: 'Delete',
  })
  if (ok) deleteComponent(def.id)
}

const shell = ref<InstanceType<typeof DrawerShell>>()
const panel = computed(() => shell.value?.el)

// Escape peels one layer at a time — filter, then the settings view — and
// never closes the column itself; only the rail does.
useDrawerEscape(panel, {
  canPeel: () => searching.value || !!settingsId.value,
  peel: () => {
    if (searching.value) query.value = ''
    else settingsId.value = null
  },
})
</script>

<template>
  <DrawerShell ref="shell" v-model:query="query" :detail="!!settingsId" placeholder="Search components…">
    <template #detail>
      <ComponentSettingsEditor :component-id="settingsId!" @back="settingsId = null" />
    </template>

    <!-- the tree is also a LAYER SURFACE: it takes focus for the tree's
         keys and is a drop target for row drags and the ⌘E dock.
         pb leaves room for a row kebab opened near the bottom -->
    <div
      ref="surface"
      data-insert-surface
      tabindex="0"
      class="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto pb-10 outline-none"
      @keydown="onKeydown"
    >
      <template v-for="(section, i) in sections" :key="section.title">
        <div class="flex items-center gap-1 px-2.5 pb-1" :class="i ? 'pt-4' : 'pt-2'">
          <span class="flex-1 section-label">
            {{ section.title }}
          </span>
        </div>

        <p
          v-if="section.title === 'Project' && !hasOwn"
          class="px-2.5 py-1 text-[10px] text-muted-foreground"
        >
          Nothing yet. Select an element on a page and choose “Create component”.
        </p>

        <div v-for="group in section.groups" :key="group.key">
          <div class="group/row mx-1 flex h-7 items-center rounded-md pr-0.5 pl-1 hover:bg-accent/15">
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none"
              @click="toggleGroup(group.key)"
            >
              <ChevronRight
                class="size-3 shrink-0 text-muted-foreground transition-transform"
                :class="isExpanded(group.key) && 'rotate-90'"
              />
              <span class="truncate text-xs font-medium">{{ group.name }}</span>
              <span class="shrink-0 text-[10px] text-muted-foreground">{{ group.cards.length }}</span>
            </button>
          </div>

          <!-- a guide line carries the nesting at this width -->
          <div v-if="isExpanded(group.key)" class="mt-0.5 mb-1 ml-3.5 border-l border-input pl-1">
            <template v-for="card in group.cards" :key="card.def.id">
              <div
                :data-component="card.def.name"
                class="group/row mr-1 flex h-7 items-center rounded-md pr-0.5 pl-1"
                :class="activeCard?.def.id === card.def.id ? 'bg-accent/25' : 'hover:bg-accent/15'"
              >
                <button
                  type="button"
                  data-row-toggle
                  class="flex size-4 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground"
                  :aria-label="isOpen(card.def) ? 'Collapse' : 'Expand'"
                  @click="toggleComponent(card.def)"
                >
                  <ChevronRight
                    class="size-3 shrink-0 transition-transform"
                    :class="isOpen(card.def) && 'rotate-90'"
                  />
                </button>
                <button
                  type="button"
                  data-row-main
                  class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
                  @click="focusCard(card.key)"
                >
                  <ComponentIcon class="size-3 shrink-0 text-muted-foreground" />
                  <span
                    class="truncate text-xs"
                    :class="activeCard?.def.id === card.def.id ? 'font-medium' : 'text-muted-foreground'"
                  >{{ card.def.name }}</span>
                </button>
                <MenuUI
                  width="w-40"
                  class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
                  trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <template #default="{ close }">
                    <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(settingsId = card.def.id, close())">
                      <Settings class="size-3.5" /> Settings
                    </button>
                    <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(duplicateComponent(card.def.id), close())">
                      <Copy class="size-3.5" /> Duplicate
                    </button>
                    <div class="mx-1 my-1 h-px bg-input" />
                    <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(confirmDelete(card.def), close())">
                      <Trash2 class="size-3.5" /> Delete
                    </button>
                  </template>
                </MenuUI>
              </div>

              <!-- the component's element tree. Its own row above stands
                   for the root wrapper, so the tree starts at its children -->
              <div v-if="isOpen(card.def)" class="mr-1 mb-1">
                <LayerRow
                  v-for="child in card.def.root.children"
                  :key="child.id"
                  :node="child"
                  :depth="1"
                />
                <p
                  v-if="!card.def.root.children.length"
                  class="py-1 pl-6 text-[10px] text-muted-foreground"
                >
                  Empty. Insert an element with ⌘E.
                </p>
              </div>
            </template>
          </div>
        </div>
      </template>

      <p v-if="noResults" class="px-2 py-6 text-center text-xs text-muted-foreground">
        No results for “{{ query.trim() }}”.
      </p>
    </div>
  </DrawerShell>
</template>

