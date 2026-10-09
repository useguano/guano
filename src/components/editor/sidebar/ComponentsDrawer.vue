<script lang="ts">
import { ref } from 'vue'

const expanded = ref<Record<string, boolean>>({})
const openComponents = ref<Record<string, boolean>>({})
const pendingGroups = ref<string[]>([])
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { ChevronRight, Component as ComponentIcon, Copy, Plus, Settings, Trash2, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import DrawerShell from './DrawerShell.vue'
import ComponentSettingsEditor from './ComponentSettingsEditor.vue'
import LayerRow from '@/components/editor/layers/LayerRow.vue'
import { useLayerSurface } from '@/components/editor/layers/useLayerSurface'
import { useAuth } from '@/composables/useAuth'
import { useComponents } from '@/composables/useComponents'
import { UNCATEGORIZED, focusCard, useComponentBoard } from '@/composables/useComponentBoard'
import type { BoardCard } from '@/composables/useComponentBoard'
import { useDrawerEscape } from '@/composables/useDrawerEscape'
import { useModal } from '@/composables/useModal'
import { useViewMode } from '@/composables/useViewMode'
import { findNode } from '@/lib/tree'
import type { ComponentDef } from '@/types/editor'

const { duplicateComponent, usageOf, deleteComponent } = useComponents()
const { cards, activeCard } = useComponentBoard()
const { confirm, openModal } = useModal()
const { canBuild } = useAuth()
const { setMode, setCanvas } = useViewMode()

const CreateComponentGroupModal = defineAsyncComponent(() => import('./CreateComponentGroupModal.vue'))
const CreateComponentModal = defineAsyncComponent(
  () => import('@/components/editor/canvas/CreateComponentModal.vue'),
)

const settingsId = ref<string | null>(null)
const settingsFocus = ref<'variants' | null>(null)
const query = ref('')

const needle = computed(() => query.value.trim().toLowerCase())
const searching = computed(() => needle.value.length > 0)
const matches = (name: string) => name.toLowerCase().includes(needle.value)

interface Group {
  key: string
  name: string
  cards: BoardCard[]
}

const byName = (a: Group, b: Group) => {
  if (a.name === UNCATEGORIZED) return 1
  if (b.name === UNCATEGORIZED) return -1
  return a.name.localeCompare(b.name)
}

const groups = computed<Group[]>(() => {
  const byCategory = new Map<string, BoardCard[]>()
  for (const card of cards.value) {
    const keepAll = searching.value && matches(card.category)
    const hit = matches(card.def.name)
    if (searching.value && !keepAll && !hit) continue
    const group = byCategory.get(card.category)
    if (group) group.push(card)
    else byCategory.set(card.category, [card])
  }
  const list = [...byCategory.entries()].map(([name, group]) => ({
    key: `own:${name}`,
    name,
    cards: [...group].sort((a, b) => a.def.name.localeCompare(b.def.name)),
  }))
  if (!searching.value) {
    const taken = new Set(list.map((group) => group.name.toLowerCase()))
    for (const name of pendingGroups.value) {
      if (taken.has(name.toLowerCase())) continue
      list.push({ key: `own:${name}`, name, cards: [] })
    }
  }
  return list.sort(byName)
})

const noResults = computed(() => searching.value && !groups.value.length)

const isExpanded = (key: string) => searching.value || expanded.value[key] !== false
const toggleGroup = (key: string) => {
  if (searching.value) return
  expanded.value[key] = expanded.value[key] === false
}

const isOpen = (def: ComponentDef) => openComponents.value[def.id] === true
const toggleComponent = (def: ComponentDef) => {
  openComponents.value[def.id] = !isOpen(def)
}

const forget = (name: string) => {
  pendingGroups.value = pendingGroups.value.filter((n) => n.toLowerCase() !== name.toLowerCase())
}

async function newGroup() {
  const name = await openModal<string>(CreateComponentGroupModal)
  if (!name) return
  const existing = cards.value.find((c) => c.category.toLowerCase() === name.toLowerCase())
  if (!existing && !pendingGroups.value.some((n) => n.toLowerCase() === name.toLowerCase())) {
    pendingGroups.value = [...pendingGroups.value, name]
  }
  expanded.value[`own:${existing?.category ?? name}`] = true
}

async function newComponent(group: Group) {
  const category = group.name === UNCATEGORIZED ? undefined : group.name
  const def = await openModal<ComponentDef>(CreateComponentModal, { category })
  if (!def) return
  if (category) forget(category)
  expanded.value[`own:${category ?? UNCATEGORIZED}`] = true
  openComponents.value[def.id] = true
  setMode('build')
  setCanvas('components')
  focusCard(def.id)
}

function openSettings(def: ComponentDef, focus: 'variants' | null = null) {
  settingsId.value = def.id
  settingsFocus.value = focus
}

function closeSettings() {
  settingsId.value = null
  settingsFocus.value = null
}

const surface = ref<HTMLElement>()
const { onKeydown } = useLayerSurface({
  surface,
  roots: () =>
    groups.value
      .filter((group) => isExpanded(group.key))
      .flatMap((group) => group.cards)
      .filter((card) => isOpen(card.def))
      .flatMap((card) => card.def.root.children),
  canRename: () => false,
  beforeReveal(id) {
    const owner = cards.value.find((c) => !!findNode(c.def.root.children, id))
    if (!owner) return
    openComponents.value[owner.def.id] = true
    expanded.value[`own:${owner.category}`] = true
  },
})

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

useDrawerEscape(panel, {
  canPeel: () => searching.value || !!settingsId.value,
  peel: () => {
    if (searching.value) query.value = ''
    else closeSettings()
  },
})
</script>

<template>
  <DrawerShell ref="shell" v-model:query="query" :detail="!!settingsId" placeholder="Search components…">
    <template #detail>
      <ComponentSettingsEditor
        :component-id="settingsId!"
        :focus="settingsFocus ?? undefined"
        @back="closeSettings"
      />
    </template>

    <div
      ref="surface"
      data-insert-surface
      tabindex="0"
      class="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto pb-10 outline-none"
      @keydown="onKeydown"
    >
      <div class="flex items-center gap-1 px-2.5 pt-2 pb-1">
        <span class="flex-1 section-label">Components</span>
        <ButtonUI
          v-if="canBuild"
          variant="icon" size="xs" :icon="Plus"
          tooltip="New group" tooltip-side="right"
          class="w-5 text-muted-foreground"
          @click.stop="newGroup"
        />
      </div>

      <p v-if="!groups.length && !searching" class="px-2.5 py-1 text-[10px] text-muted-foreground">
        Nothing yet. Add a group with +, then a component inside it. Or select an element on a page
        and choose “Create component”.
      </p>

      <div v-for="group in groups" :key="group.key">
        <div
          :data-component-group="group.name"
          class="group/row mx-1 flex h-7 items-center rounded-md pr-0.5 pl-1 hover:bg-accent/15"
        >
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

          <ButtonUI
            v-if="canBuild"
            variant="icon" size="xs" :icon="Plus" tooltip="New component"
            class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
            @click.stop="newComponent(group)"
          />
          <ButtonUI
            v-if="canBuild && !group.cards.length"
            variant="icon" size="xs" :icon="X" tooltip="Remove the group"
            class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
            @click.stop="forget(group.name)"
          />
        </div>

        <div v-if="isExpanded(group.key)" class="mt-0.5 mb-1 ml-3.5 border-l border-input pl-1">
          <div v-if="canBuild && !group.cards.length" class="px-1.5 py-1">
            <ButtonUI variant="outline" size="xs" :icon="Plus" @click="newComponent(group)">
              Create component
            </ButtonUI>
          </div>

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
              <ButtonUI
                v-if="canBuild"
                variant="icon" size="xs" :icon="Plus" tooltip="Add a variant"
                class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
                @click.stop="openSettings(card.def, 'variants')"
              />
              <MenuUI
                width="w-40"
                class="opacity-0 group-hover/row:opacity-100 data-[open]:opacity-100"
                trigger-class="flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <template #default="{ close }">
                  <button type="button" class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30" @click="(openSettings(card.def), close())">
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

      <p v-if="noResults" class="px-2 py-6 text-center text-xs text-muted-foreground">
        No results for “{{ query.trim() }}”.
      </p>
    </div>
  </DrawerShell>
</template>
