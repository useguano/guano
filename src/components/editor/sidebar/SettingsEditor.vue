<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import {
  Palette, Zap, GitBranch, Sun, Moon, Paperclip,
  MessageCircle, CircleCheck, CircleAlert, CircleX, Rocket,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import PanelPopoverBody from '@/components/editor/sidebar/PanelPopoverBody.vue'
import PublishPopover from '@/components/editor/sidebar/PublishPopover.vue'
import CommentsEditor from '@/components/shared/CommentsEditor.vue'
import { useBranches } from '@/composables/useBranches'
import { useComments } from '@/composables/useComments'
import { usePersistence, SAVE_STATES } from '@/composables/usePersistence'
import { useElement } from '@/composables/useElement'
import { elementIcon } from '@/lib/elementIcons'
import { useAuth } from '@/composables/useAuth'
import { usePanel } from '@/composables/usePanel'
import { usePopover } from '@/composables/usePopover'
import { useModal } from '@/composables/useModal'
import { useInteraction } from '@/composables/useInteraction'
import { isEditable } from '@/composables/useShortcut'
import { useTheme } from '@/composables/useTheme'
import { onBeforeUnmount, onMounted } from 'vue'

interface Panel {
  id: string
  label: string
  icon: Component
  divider?: boolean
}

const ALL_PANELS: Panel[] = [
  { id: 'data', label: 'Data', icon: Paperclip },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'interactions', label: 'Interactions', icon: Zap },
  { id: 'branches', label: 'Drafts', icon: GitBranch, divider: true },
]

const { canBuild, canEditContent } = useAuth()

// The sidebar options are PER ACCOUNT TYPE, not per mode — build roles keep the
// full inspector in both Build and Preview. Contributors are content-only, so
// they only get Drafts (they can create/apply drafts and publish); the
// element-editing panels are hidden for them. Per-page custom code is NOT here
// — it is page metadata, so it lives in the page's own settings view
// (PageSettingsEditor, from the Pages drawer).
// A reviewer gets none: they hold no drafts and publish nothing, so the
// rail is the comments button alone.
const panels = computed<Panel[]>(() =>
  canBuild.value
    ? ALL_PANELS
    : canEditContent.value
      ? ALL_PANELS.filter((p) => p.id === 'branches')
      : [],
)

const { activePanelId, togglePanel, closePanel } = usePanel()
const activePanel = computed(() => panels.value.find((p) => p.id === activePanelId.value))
const { pickingFor } = useInteraction()
const { selectedElement, isMultiSelect, requestReveal } = useElement()

// Escape always returns to the Layers tree with the current selection in view:
// it closes an open panel first, and otherwise pulls focus back from the
// canvas/sidebar. It defers to a focused text field (inputs handle their own
// Escape) and to target picking.
// The panel popover opts out of the PopoverHost Escape (closeOnEscape: false)
// so this handler stays the single owner of that flow.
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (useModal().stack.value.length) return // an open modal owns Escape
  if (pickingFor.value) return // target picking cancels first
  if (activePanelId.value) {
    closePanel()
    requestReveal()
  } else if (!isEditable(document.activeElement)) {
    requestReveal()
  }
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

const { onMain } = useBranches()
const { theme, toggleTheme } = useTheme()

// rail buttons (w-7) sit inset ~10px inside the w-12 rail; the default 8px gap
// would leave popovers nearly flush against the sidebar, so bump the offset to
// clear its edge by ~8px — matching the InsertDock's gap-2 (8px) between its
// trigger button and the panel that grows out of it
const RAIL_POPOVER_OFFSET = 18

// save status as a bare stroke-circle icon (check / ! / ✕); click opens the
// save/publish popover (status badges + the Publish button live there)
const { status } = usePersistence()
const SAVE_ICONS = { saved: CircleCheck, pending: CircleAlert, error: CircleX } as const
const SAVE_COLORS = { saved: 'text-success', pending: 'text-pending', error: 'text-danger' } as const

const statusBtn = ref<InstanceType<typeof ButtonUI>>()
function togglePublish() {
  const anchor = statusBtn.value?.$el as HTMLElement | undefined
  if (!anchor) return
  usePopover().togglePopover({
    id: 'publish-status',
    component: PublishPopover,
    anchor,
    placement: 'left-start',
    offset: RAIL_POPOVER_OFFSET,
    title: 'Publish',
    icon: Rocket,
    closeOnOutside: true,
  })
}

// comments popover, anchored to its rail button in the app PopoverHost
const commentsBtn = ref<InstanceType<typeof ButtonUI>>()
const { hasUnseen, unseenCount } = useComments()
function toggleComments() {
  const anchor = commentsBtn.value?.$el as HTMLElement | undefined
  if (!anchor) return
  // the stamp that puts the unseen dot out is CommentsEditor's own, on mount:
  // whoever opens the panel, however, is then the one marking it read
  usePopover().togglePopover({
    id: 'comments',
    component: CommentsEditor,
    anchor,
    placement: 'left-start',
    offset: RAIL_POPOVER_OFFSET,
    title: 'Comments',
    icon: MessageCircle,
    closeOnOutside: true,
  })
}

// element-editing panels show the selected element's icon in the header
const ELEMENT_PANELS = ['data', 'style', 'interactions']

/** these panels edit a single element, so they're blocked during a multi-selection */
const blocked = (id: string) => ELEMENT_PANELS.includes(id) && isMultiSelect.value
function onTabClick(id: string) {
  if (blocked(id)) return
  togglePanel(id)
}
const headerIcon = computed(() => {
  if (activePanel.value && ELEMENT_PANELS.includes(activePanel.value.id) && selectedElement.value) {
    return elementIcon(selectedElement.value.type)
  }
  return activePanel.value?.icon
})

/** the popover title. `title` is passed as a getter, so it stays live without
 * reopening — the panel no longer drills into anything, so it is just the
 * panel's own label. */
function panelTitle(): string {
  return activePanel.value?.label ?? ''
}

// --- the panel popover lives in the app PopoverHost, anchored to the rail
// button that opened it (so it sits vertically vis-à-vis its trigger, like the
// publish/comments popovers). Switching panels re-anchors to the new button: a
// same-id openPopover updates anchor/title/icon in place — no reopen, no
// onClose — so PanelPopoverBody's body still swaps reactively.
const railEl = ref<HTMLElement>()
const { currentId, openPopover, closePopover } = usePopover()

// per-panel button DOM nodes, keyed by panel id (function refs in the v-for)
const panelBtns = new Map<string, HTMLElement>()
function setPanelBtn(id: string, el: unknown) {
  const dom = (el as { $el?: HTMLElement } | null)?.$el
  if (dom) panelBtns.set(id, dom)
  else panelBtns.delete(id)
}

watch(activePanel, (panel) => {
  if (panel) {
    const anchor = panelBtns.get(panel.id) ?? railEl.value
    if (!anchor) return
    openPopover({
      id: 'sidebar-panel',
      component: PanelPopoverBody,
      anchor,
      placement: 'left-start',
      offset: RAIL_POPOVER_OFFSET,
      title: panelTitle,
      icon: headerIcon,
      closeOnEscape: false,
      onClose: () => closePanel(),
    })
  } else if (currentId.value === 'sidebar-panel') {
    closePopover()
  }
})
</script>

<template>
  <aside ref="railEl" class="relative flex h-full w-12 flex-col items-center gap-1 py-4">
    <!-- the save/publish status: a reviewer saves only comments and never
         publishes, so there is nothing for the popover to show them -->
    <ButtonUI
      v-if="canEditContent"
      ref="statusBtn"
      variant="ghost"
      :icon="SAVE_ICONS[status]"
      :aria-label="status === 'error' ? 'Save failed' : SAVE_STATES[status].label"
      aria-live="polite"
      class="w-7"
      :class="currentId === 'publish-status' ? '!bg-accent/30 text-accent-foreground' : SAVE_COLORS[status]"
      @click="togglePublish"
    />
    <div class="my-1 h-px w-full bg-input" />

    <template v-for="panel in panels" :key="panel.id">
      <div v-if="panel.divider" class="my-1 h-px w-full bg-input" />
      <ButtonUI
        :ref="(el) => setPanelBtn(panel.id, el)"
        variant="ghost"
        :icon="panel.icon"
        :aria-label="panel.label"
        class="w-7"
        :disabled="blocked(panel.id)"
        :class="
          blocked(panel.id)
            ? 'opacity-40'
            : activePanelId === panel.id
              ? '!bg-accent/30 text-accent-foreground'
              : panel.id === 'branches' && !onMain
                ? 'text-pending'
                : 'text-muted-foreground'
        "
        @click="onTabClick(panel.id)"
      />
      
    </template>
    <div class="relative flex">
      <ButtonUI
        ref="commentsBtn"
        variant="ghost"
        :icon="MessageCircle"
        :aria-label="hasUnseen ? `Comments, ${unseenCount} unread` : 'Comments'"
        class="w-7"
        :class="currentId === 'comments' ? '!bg-accent/30 text-accent-foreground' : 'text-muted-foreground'"
        @click="toggleComments"
      />
      <!-- unseen activity: a dot rather than a count, which at this size
           would be unreadable. The ring keeps it legible over the rail in
           either theme. The aria-label above carries the number. -->
      <span
        v-if="hasUnseen"
        class="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-success ring-2 ring-background"
      />
    </div>
    <ButtonUI
      variant="ghost"
      :icon="theme === 'light' ? Sun : Moon"
      :aria-label="theme === 'light' ? 'Switch to dark' : 'Switch to light'"
      class="mt-auto w-7 text-muted-foreground"
      @click="toggleTheme"
    />
    
  </aside>
</template>
