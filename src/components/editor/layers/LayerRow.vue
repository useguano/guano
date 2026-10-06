<script setup lang="ts">
/**
 * One row of the Layers tree, and — recursively — its children.
 *
 * The row reads the composables directly rather than taking them as props:
 * it is instantiated once per element, and prop-drilling selection, the
 * backend and the collapse state through every level of a deep tree costs
 * more than it documents.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, Eye, EyeOff, Palette, Paperclip, Zap } from 'lucide-vue-next'
import { elementIcon } from '@/lib/elementIcons'
import { isComponentType } from '@/lib/components'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useAuth } from '@/composables/useAuth'
import { useContextMenu } from '@/composables/useContextMenu'
import { useInteraction } from '@/composables/useInteraction'
import { useStructure } from '@/composables/useStructure'
import { usePanel } from '@/composables/usePanel'
import { useLayerState } from './layerState'
import { layerLabel } from './layerLabel'
import { useLayerFilter } from './layerFilter'
import { useLayerSurfaceRow } from './useLayerSurface'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode; depth: number }>()
const surface = useLayerSurfaceRow()

const {
  selectElement, highlightElement, isSelected, isHighlighted, dropPositionFor,
} = useElement()
const { masterFor, isHidden, setHidden } = useComponents()
const { canBuild } = useAuth()
const { openMenu } = useContextMenu()
const { pickingFor, pickTarget } = useInteraction()
const { backend } = useStructure()
const { togglePanel } = usePanel()
const { isCollapsed, toggle, editingRefId } = useLayerState()

// per-id marks: a hover or selection change reaches only the rows it concerns,
// not a computed in every row of the tree
const selected = computed(() => isSelected(props.node.id))
const highlighted = computed(() => isHighlighted(props.node.id))
const hasChildren = computed(() => props.node.children.length > 0)
// a search prunes the tree to the hits and their ancestors, and shows every
// surviving branch open — collapse state is how you read a tree, not how you
// read a result
const filter = useLayerFilter()
const filtered = computed(() => filter?.value ?? null)
const visible = computed(() => !filtered.value || filtered.value.has(props.node.id))
const open = computed(
  () => hasChildren.value && (!!filtered.value || !isCollapsed(props.node.id)),
)
const isInstance = computed(() => isComponentType(props.node.type))
/** what a `[arg]` means on this element: a CMS binding everywhere but on a
 *  component wrapper, whose slot is not a field */
const isCms = computed(() => {
  const n = props.node
  return (
    n.type === 'collection-list' || n.type === 'collection-item' ||
    (!isInstance.value && n.type !== 'body' && !!n.arg)
  )
})
/**
 * Rows read by what they are, not only by what they say: a component
 * instance (and everything inside it, which the master owns) in the
 * component tint, a CMS list / item / bound field in the CMS tint.
 */
const kind = computed<'component' | 'cms' | null>(() => {
  if (isInstance.value) return 'component'
  if (isCms.value) return 'cms'
  return masterFor(props.node.id) ? 'component' : null
})
const kindClass = computed(() =>
  kind.value === 'component' ? 'text-layer-component'
  : kind.value === 'cms' ? 'text-layer-cms'
  : '',
)
/** hidden rows stay in the tree — it is the only place left to show them again */
const hidden = computed(() => isHidden(props.node))
const canHide = computed(() => canBuild.value && props.node.type !== 'body')

// the label lives in `layerLabel.ts`: the search filtering this tree matches
// on exactly what the row shows
const label = computed(() => layerLabel(props.node, masterFor))

/** shown after the label when the label isn't already the type */
const secondary = computed(() =>
  props.node.slot ? 'slot' : label.value === props.node.type ? '' : props.node.type,
)

// the three badges mirror the panels they open — and stand in for the `(+)`,
// `{+}` and `[+]` markers the code editor used to show on the token line
const badges = computed(() => {
  const n = props.node
  const master = masterFor(n.id)?.master
  const styled = !!(n.classes?.trim() || master?.classes?.trim())
  const wired = !!(n.interactions?.length || n.animations?.length || master?.interactions?.length)
  const owns = !!(
    n.content || n.src || n.svg || n.slider || master?.content || master?.src || master?.svg
  )
  return [
    styled && { key: 'style', icon: Palette, title: 'Styled — open Style' },
    wired && { key: 'interactions', icon: Zap, title: 'Interactive — open Interactions' },
    owns && { key: 'data', icon: Paperclip, title: 'Has content — open Data' },
  ].filter(Boolean) as { key: string; icon: typeof Palette; title: string }[]
})

function onClick(e: MouseEvent) {
  // a pending "Pick target" claims the click instead of selecting — the same
  // rule the canvas follows, so picking works from either surface
  if (pickingFor.value) {
    const mapping = masterFor(props.node.id)
    pickTarget(mapping ? mapping.master.id : props.node.id)
    return
  }
  if (e.shiftKey) {
    // extending is only meaningful among siblings, which is what the
    // selection model supports
    selectElement(props.node.id)
    return
  }
  selectElement(props.node.id)
}

/** where a drag currently wants to land relative to THIS row */
const dropHere = computed(() =>
  dropPositionFor(props.node.id),
)

// --- inline ref rename: the only way a human can set a #ref now ---

const editing = computed(() => editingRefId.value === props.node.id)
const refDraft = ref('')
const refError = ref('')
const refInput = ref<HTMLInputElement>()

watch(editing, async (on) => {
  if (!on) return
  refDraft.value = props.node.ref ?? ''
  refError.value = ''
  await nextTick()
  refInput.value?.focus()
  refInput.value?.select()
})

function startRename() {
  if (backend.value.can(props.node, 'ref')) editingRefId.value = props.node.id
}

function commitRef() {
  if (!editing.value) return
  const next = refDraft.value.trim()
  if (next === (props.node.ref ?? '')) {
    editingRefId.value = null
    return
  }
  if (backend.value.setRef(props.node.id, next || null)) {
    editingRefId.value = null
    return
  }
  // setRef refuses a bad charset, the body, and a name already used on this
  // page — say which, rather than just snapping back
  refError.value = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(next)
    ? 'Already used on this page'
    : 'Letters, digits and dashes; must start with a letter'
}
</script>

<template>
  <div v-if="visible" :class="hidden && 'opacity-50'">
    <div
      :data-layer-row="node.id"
      :data-layer-hidden="hidden || undefined"
      class="group/row flex h-7 items-center gap-1 rounded-lg pr-1 text-xs"
      :class="[
        selected
          ? 'bg-accent/30 text-foreground'
          : highlighted
            ? 'bg-accent/15 text-foreground'
            : 'text-muted-foreground hover:bg-accent/15',
        dropHere === 'before' && 'shadow-[inset_0_2px_0_0_#0ea5e9]',
        dropHere === 'after' && 'shadow-[inset_0_-2px_0_0_#0ea5e9]',
        dropHere === 'inside' && 'ring-1 ring-sky-500',
      ]"
      :style="{ paddingLeft: `${depth * 6 + 4}px` }"
      @click="onClick"
      @dblclick="startRename"
      @contextmenu="openMenu($event, node.id)"
      @pointerdown="surface?.onRowPointerDown($event, node.id)"
      @pointerenter="highlightElement(node.id)"
      @pointerleave="highlightElement(null)"
    >
      <!-- the twisty keeps its slot even on a leaf, so labels line up -->
      <button
        v-if="hasChildren"
        type="button"
        class="flex size-4 shrink-0 items-center justify-center rounded outline-none hover:text-foreground"
        :aria-label="open ? 'Collapse' : 'Expand'"
        @click.stop="toggle(node.id)"
      >
        <ChevronRight class="size-3 transition-transform" :class="open && 'rotate-90'" />
      </button>
      <span v-else class="size-4 shrink-0" />

      <component :is="elementIcon(node.type)" class="size-3 shrink-0" :class="kindClass" />
      <input
        v-if="editing"
        ref="refInput"
        v-model="refDraft"
        v-tooltip="refError ? { text: refError, side: 'bottom' } : ''"
        type="text"
        spellcheck="false"
        placeholder="ref"
        class="min-w-0 flex-1 rounded bg-input px-1 text-xs outline-none"
        :class="refError && 'ring-1 ring-danger'"
        @click.stop
        @pointerdown.stop
        @blur="commitRef"
        @keydown.enter.stop.prevent="commitRef"
        @keydown.esc.stop.prevent="editingRefId = null"
      />
      <span v-else class="min-w-0 flex-1 truncate" :class="[selected && 'font-medium', kindClass]">
        {{ label }}
        <span v-if="secondary" class="ml-1 text-[10px] opacity-50">{{ secondary }}</span>
      </span>

      <span class="flex shrink-0 items-center gap-0.5 opacity-60 group-hover/row:opacity-100">
        <!-- shown on hover, and always while hidden: the state has to be visible
             on a row nobody is pointing at -->
        <button
          v-if="canHide"
          type="button"
          data-layer-eye
          class="size-4 items-center justify-center rounded outline-none hover:text-foreground"
          :class="hidden ? 'flex' : 'hidden group-hover/row:flex'"
          :aria-label="hidden ? 'Show' : 'Hide'"
          :aria-pressed="hidden"
          @click.stop="setHidden(node, !hidden)"
          @dblclick.stop
        >
          <component :is="hidden ? EyeOff : Eye" class="size-3" />
        </button>
        <button
          v-for="badge in badges"
          :key="badge.key"
          v-tooltip="{ text: badge.title, side: 'left' }"
          type="button"
          class="flex size-4 items-center justify-center rounded outline-none hover:text-foreground"
          @click.stop="(selectElement(node.id), togglePanel(badge.key))"
        >
          <component :is="badge.icon" class="size-3" />
        </button>
      </span>
    </div>

    <template v-if="open">
      <LayerRow v-for="child in node.children" :key="child.id" :node="child" :depth="depth + 1" />
    </template>
  </div>
</template>
