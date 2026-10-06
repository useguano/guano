<script setup lang="ts">
// The Interactions panel: trigger-first, and only the triggers.
//
// You say WHEN here — "+ Trigger", then the list — and that creates the
// trigger's ONE action, a new effect, which is edited in the effects drawer
// under the canvas: its options and the effect itself, side by side, with the
// element's states. The panel is a floating popover that closes under a target
// pick and has the width of a column; the drawer has the width of the canvas
// and stays put. So this is an index of the element's triggers, each a way into
// the drawer, and nothing is edited in it.
//
// What an effect DOES is shared by every element using it, so it too is edited
// in the drawer (⌘⇧E) — never in here, where a change that retimed the whole
// site read as a change to this one element.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, Plus, Zap } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import { useElement } from '@/composables/useElement'
import { useElementEffects } from '@/composables/useElementEffects'
import { useEffects } from '@/composables/useEffects'
import { useInteraction } from '@/composables/useInteraction'
import { useShortcut } from '@/composables/useShortcut'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { triggerOrder, triggerSentence, uiTrigger } from '@/lib/effectTriggers'

const { highlightElement, isMultiSelect } = useElement()
const { pickingFor } = useInteraction()
const { nameOf } = useEffects()
const { target, canEdit, elementLabel, sections, availableTriggers, createActionFor } =
  useElementEffects()
const {
  open: drawerOpen,
  view: drawerView,
  trigger: drawerTrigger,
  openTrigger,
  effectCreated,
  toggleDrawer,
} = useEffectsDrawer()

// Esc cancels a pending target pick
useShortcut('Escape', { onDown: () => (pickingFor.value = null) })

/**
 * The element's triggers, plus the one the drawer is filling when it has no
 * action yet — so "+ Trigger" lands a row at once rather than only after the
 * first action is picked.
 */
const rows = computed(() => {
  const list = sections.value.map((s) => ({
    trigger: s.trigger,
    sentence: s.sentence,
    // one action per trigger: the row says which effect it runs
    effect: s.rows[0] ? nameOf(s.rows[0]) : '',
  }))
  const pending = drawerOpen.value ? drawerTrigger.value : null
  if (pending && !list.some((r) => r.trigger === pending)) {
    list.push({ trigger: pending, sentence: triggerSentence(pending), effect: '' })
  }
  return list.sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger))
})

const totalActions = computed(() => sections.value.reduce((n, s) => n + s.rows.length, 0))

/** the row the drawer is showing — the one highlighted here */
const current = computed(() =>
  drawerOpen.value && drawerView.value === 'trigger' ? drawerTrigger.value : null,
)

const addingTrigger = ref(false)

/** "+ Trigger" → a new effect bound under it, and the drawer open on it: the
 *  options and the effect are there to edit at once, nothing to pick first.
 *  Flagged fresh so the drawer's Cancel discards effect and binding together. */
function addTrigger(trigger: string) {
  addingTrigger.value = false
  const effect = createActionFor(trigger)
  openTrigger(trigger)
  if (effect) effectCreated(effect.id)
}

const offered = computed(() =>
  availableTriggers.value.filter((t) => !rows.value.some((r) => r.trigger === t.key)),
)

watch(
  () => target.value?.id,
  () => {
    addingTrigger.value = false
  },
)

// `I` in the Layers tree: the panel's primary action is adding a trigger
const { pendingFocus } = usePanel()
const addButton = ref<InstanceType<typeof ButtonUI>>()
function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => addButton.value?.$el?.focus?.())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)
// don't leave a dangling preview outline when the panel closes
onBeforeUnmount(() => highlightElement(null))
</script>

<template>
  <GroupPopover v-if="!canEdit">
    <p class="text-xs text-muted-foreground">
      {{
        isMultiSelect
          ? 'Select a single element to give it interactions.'
          : 'Select an element to give it interactions.'
      }}
    </p>
    <!-- the effect library is project-level, so it is reachable with nothing
         selected — only applying an effect needs an element -->
    <ButtonUI ref="addButton" variant="outline" size="sm" class="w-full" @click="toggleDrawer()">
      {{ drawerOpen ? 'Hide effects' : 'Open effects' }}
    </ButtonUI>
  </GroupPopover>

  <div v-else class="flex flex-col">
    <!-- which element this is about, and the one way in -->
    <div class="flex items-center gap-1.5 border-b border-input px-3 py-2">
      <p class="min-w-0 flex-1 truncate text-xs font-medium">
        {{ elementLabel }}
        <span v-if="totalActions" class="text-muted-foreground">· {{ totalActions }}</span>
      </p>
      <ButtonUI
        ref="addButton"
        variant="outline"
        size="xs"
        :icon="Plus"
        :disabled="!offered.length"
        @click="addingTrigger = !addingTrigger"
      >
        Trigger
      </ButtonUI>
    </div>

    <!-- + Trigger: inline, with the one line each choice needs -->
    <div v-if="addingTrigger" class="flex flex-col gap-1 border-b border-input p-2">
      <button
        v-for="t in offered"
        :key="t.key"
        type="button"
        class="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
        @click="addTrigger(t.key)"
      >
        <component :is="t.icon" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-xs">{{ t.label }}</span>
          <span class="block text-[10px] text-muted-foreground">{{ t.hint }}</span>
        </span>
      </button>
    </div>

    <!-- the element's triggers: each one opens the drawer where it is managed -->
    <GroupPopover v-if="rows.length">
      <button
        v-for="row in rows"
        :key="row.trigger"
        type="button"
        data-trigger-row
        class="flex h-8 items-center gap-2 rounded-xl border px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
        :class="
          current === row.trigger
            ? 'border-accent bg-accent/5'
            : 'border-input hover:border-accent'
        "
        @click="openTrigger(row.trigger)"
      >
        <component
          :is="uiTrigger(row.trigger)?.icon ?? Zap"
          class="size-3.5 shrink-0 text-muted-foreground"
        />
        <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ row.sentence }}</span>
        <span class="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
          {{ row.effect || 'empty' }}
        </span>
        <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
      </button>
    </GroupPopover>

    <GroupPopover v-else>
      <p class="text-xs text-muted-foreground">
        Nothing yet. Add a trigger to say when something happens.
      </p>
    </GroupPopover>

    <!-- the library and every effect's own settings live one surface down -->
    <GroupPopover>
      <ButtonUI
        variant="ghost"
        size="xs"
        :icon="Zap"
        class="w-full !justify-start text-muted-foreground"
        @click="toggleDrawer()"
      >
        {{ drawerOpen ? 'Hide effects' : 'All effects' }}
      </ButtonUI>
    </GroupPopover>
  </div>
</template>
