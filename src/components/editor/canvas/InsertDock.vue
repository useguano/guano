<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component as VueComponent } from 'vue'
import { Component, CornerDownLeft, Plus } from 'lucide-vue-next'
import InputUI from '@/components/ui/InputUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useComponents } from '@/composables/useComponents'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useElement } from '@/composables/useElement'
import { useStructure } from '@/composables/useStructure'
import { useInsertDrag, type InsertPayload } from '@/composables/useInsertDrag'
import { ELEMENT_GROUPS, paletteKey } from '@/lib/elementPalette'
import { fuzzyScore } from '@/lib/fuzzy'
import { canNest } from '@/lib/instances'
import { useComponentBoard } from '@/composables/useComponentBoard'

const { components } = useComponents()
const { open, closePalette, togglePalette, insertElement, insertComponent } = useCommandPalette()
const { requestReveal } = useElement()
const { backend } = useStructure()
const { activeCard } = useComponentBoard()
const { startInsertDrag } = useInsertDrag()

const query = ref('')
const active = ref(0)

type Tab = 'all' | 'basic' | 'components'
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'basic', label: 'Basic' },
  { key: 'components', label: 'Components' },
]
const tab = ref<Tab>('all')
const input = ref<InstanceType<typeof InputUI>>()
const listEl = ref<HTMLElement>()

function scrollActiveIntoView() {
  nextTick(() =>
    listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }),
  )
}

interface DockGroup {
  title: string
  tab: Exclude<Tab, 'all'>
  items: DockItem[]
}

interface DockItem {
  key: string
  label: string
  keywords: string[]
  icon: VueComponent
  accent: boolean
  payload: InsertPayload
  run: () => void
}

const allGroups = computed<DockGroup[]>(() => {
  const base: DockGroup[] = ELEMENT_GROUPS.map((g) => ({
    title: g.title,
    tab: 'basic' as const,
    items: g.items.map((item) => ({
      key: paletteKey(item),
      label: item.label,
      keywords: [item.type],
      icon: item.icon,
      accent: false,
      payload: {
        kind: 'element',
        type: item.type,
        classes: item.classes,
        label: item.label,
        icon: item.icon,
      },
      run: () => insertElement(item.type, item.classes),
    })),
  }))
  const card = backend.value.kind === 'master' ? activeCard.value : null
  const host = card?.def ?? null
  const known = host && !components.value.includes(host) ? [...components.value, host] : components.value
  const fits = (name: string) => !host || canNest(known, host.name, name)
  const offered = components.value.filter((c) => fits(c.name))
  if (offered.length) {
    base.push({
      title: 'Components',
      tab: 'components',
      items: offered.map((c) => ({
        key: `component:${c.id}`,
        label: c.name,
        keywords: [],
        icon: Component,
        accent: true,
        payload: { kind: 'component', name: c.name },
        run: () => insertComponent(c.name),
      })),
    })
  }
  return base
})

const results = computed(() => {
  const q = query.value.trim()
  const groups: { title: string; items: { item: DockItem; index: number }[] }[] = []
  const flat: DockItem[] = []
  for (const group of allGroups.value) {
    if (tab.value !== 'all' && group.tab !== tab.value) continue
    const matched = q
      ? group.items
          .map((item) => {
            const scores = [item.label, ...item.keywords]
              .map((t) => fuzzyScore(q, t))
              .filter((s): s is number => s !== null)
            return scores.length ? { item, score: Math.max(...scores) } : null
          })
          .filter((x): x is { item: DockItem; score: number } => x !== null)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.item)
      : group.items
    if (!matched.length) continue
    groups.push({
      title: group.title,
      items: matched.map((item) => {
        const index = flat.length
        flat.push(item)
        return { item, index }
      }),
    })
  }
  return { groups, flat }
})

watch([query, tab], () => (active.value = 0))

const emptyHint = computed(() => {
  if (results.value.flat.length) return ''
  if (query.value.trim()) return 'No results'
  if (tab.value === 'components') {
    return 'Nothing yet — select an element on a page and choose “Create component”.'
  }
  return 'No results'
})
watch(
  () => results.value.flat.length,
  (len) => {
    if (active.value >= len) active.value = Math.max(0, len - 1)
  },
)

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
  }
}

const dockRoot = ref<HTMLElement>()
function onDocClick(e: MouseEvent) {
  if (dockRoot.value && !dockRoot.value.contains(e.target as Node)) closePalette()
}

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    tab.value = 'all'
    active.value = 0
    nextTick(() => input.value?.focus())
    window.addEventListener('keydown', onWindowKeydown)
    nextTick(() => document.addEventListener('click', onDocClick))
  } else {
    window.removeEventListener('keydown', onWindowKeydown)
    document.removeEventListener('click', onDocClick)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('click', onDocClick)
})

function pick(item: DockItem) {
  item.run()
  requestReveal()
}

function navigate(dir: 'up' | 'down' | 'left' | 'right') {
  const container = listEl.value
  if (!container) return
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-idx]'))
  if (!cards.length) return
  const cur = cards.find((c) => Number(c.dataset.idx) === active.value) ?? cards[0]!
  const cr = cur.getBoundingClientRect()
  const cx = cr.left + cr.width / 2
  const cy = cr.top + cr.height / 2

  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const card of cards) {
    if (card === cur) continue
    const r = card.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    let primary: number
    let cross: number
    if (dir === 'right') {
      if (dx <= 1) continue
      primary = dx
      cross = Math.abs(dy)
    } else if (dir === 'left') {
      if (dx >= -1) continue
      primary = -dx
      cross = Math.abs(dy)
    } else if (dir === 'down') {
      if (dy <= 1) continue
      primary = dy
      cross = Math.abs(dx)
    } else {
      if (dy >= -1) continue
      primary = -dy
      cross = Math.abs(dx)
    }
    const score = primary + cross * 2
    if (score < bestScore) {
      bestScore = score
      best = card
    }
  }
  if (best) {
    active.value = Number(best.dataset.idx)
    scrollActiveIntoView()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    navigate('down')
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    navigate('up')
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    navigate('right')
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    navigate('left')
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = results.value.flat[active.value]
    if (item) {
      pick(item)
      closePalette()
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
  }
}
</script>

<template>

  <div
    ref="dockRoot"
    class="absolute bottom-1 left-1 z-40 flex max-w-[calc(100%-2rem)] flex-col-reverse items-start gap-2"
    @click.stop
  >
    <button
      v-tooltip.right="'Insert elements (⌘E)'"
      type="button"
      class="flex size-10 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground shadow-lg transition-all duration-200"
      :class="open ? 'rotate-45' : ''"
      @click="togglePalette"
    >
      <Plus class="size-5" />
    </button>

    <Transition name="dock">
      <div
        v-if="open"
        class="flex w-[28rem] origin-bottom-left flex-col overflow-hidden rounded-2xl border border-input bg-background/96 shadow-xl backdrop-blur"
        @keydown="onKeydown"
      >
        <div class="flex flex-col gap-3 border-b border-input p-4">
          <div class="dock-search relative">
            <InputUI ref="input" size="lg" v-model="query" placeholder="Search elements & components…" />
            <CornerDownLeft
              class="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
          </div>

          <div class="flex items-center gap-1">
            <ButtonUI
              v-for="t in TABS"
              :key="t.key"
              size="xs"
              :variant="tab === t.key ? 'default' : 'ghost'"
              class="text-muted-foreground"
              :class="tab === t.key && '!text-primary-foreground'"
              :data-dock-tab="t.key"
              @mousedown.prevent
              @click="tab = t.key"
            >
              {{ t.label }}
            </ButtonUI>
          </div>
        </div>

        <div
          ref="listEl"
          class="dock-scroll flex max-h-96 flex-col gap-3 overflow-y-auto p-4"
          @wheel.stop
        >
          <div v-for="group in results.groups" :key="group.title" class="flex flex-col gap-2">
            <p class="px-0.5 section-label">
              {{ group.title }}
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="{ item, index } in group.items"
                :key="item.key"
                type="button"
                :data-idx="index"
                :data-dock-item="item.key"
                :data-active="index === active"
                class="flex aspect-square w-16 shrink-0 cursor-grab touch-none flex-col items-center justify-center gap-1.5 rounded-xl border p-2 transition-colors select-none active:cursor-grabbing"
                :class="
                  index === active
                    ? 'border-accent bg-accent/20'
                    : 'border-input bg-background hover:border-accent hover:bg-accent/10'
                "
                @mousemove="active = index"
                @click="pick(item)"
                @pointerdown.left="startInsertDrag(item.payload, $event)"
              >
                <component
                  :is="item.icon"
                  class="size-4 shrink-0"
                  :class="item.accent ? 'text-success' : 'text-foreground'"
                />
                <span class="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
                  {{ item.label }}
                </span>
              </button>
            </div>
          </div>

          <p v-if="emptyHint" class="px-6 py-6 text-center text-xs text-muted-foreground">
            {{ emptyHint }}
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dock-enter-active,
.dock-leave-active {
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.15s ease;
}
.dock-enter-from,
.dock-leave-to {
  transform: scale(0.9) translateY(6px);
  opacity: 0;
}

.dock-search :deep(input) {
  padding-right: 2rem;
}
</style>
