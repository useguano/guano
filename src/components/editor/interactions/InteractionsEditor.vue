<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, Plus, Trash2, Zap } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import { useElement } from '@/composables/useElement'
import { useElementEffects } from '@/composables/useElementEffects'
import type { EffectPair } from '@/composables/useEffects'
import { useAnimation } from '@/composables/useAnimation'
import { useInteraction } from '@/composables/useInteraction'
import { useMotion } from '@/composables/useMotion'
import { useShortcut } from '@/composables/useShortcut'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { UI_TRIGGERS, triggerOrder, triggerSentence, uiTrigger } from '@/lib/effectTriggers'

const { highlightElement, isMultiSelect } = useElement()
const interactions = useInteraction()
const animations = useAnimation()
const motion = useMotion()
const { pickingFor } = interactions
const { target, canEdit, elementLabel, actions, createActionFor } = useElementEffects()
const {
  open: drawerOpen,
  view: drawerView,
  trigger: drawerTrigger,
  action: drawerAction,
  openTrigger,
  toggleDrawer,
  closeDrawer,
} = useEffectsDrawer()

useShortcut('Escape', { onDown: () => (pickingFor.value = null) })

type Row = {
  key: string
  trigger: string
  sentence: string
  effect: string
  pair: EffectPair | null
}

const rows = computed<Row[]>(() => {
  const list: Row[] = actions.value.map((a) => ({
    key: a.key,
    trigger: a.trigger,
    sentence: a.sentence,
    effect: a.name,
    pair: a.pair,
  }))
  const pending = drawerOpen.value ? drawerTrigger.value : null
  if (pending && !list.some((r) => r.trigger === pending)) {
    list.push({
      key: '',
      trigger: pending,
      sentence: triggerSentence(pending),
      effect: '',
      pair: null,
    })
  }
  return list.sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger))
})

// the one place an action is taken off the element: the index lists them, so it
// is where one is removed. The drawer edits the effect and nothing else.
function removeRow(row: Row) {
  const owner = target.value
  if (!owner || !row.pair) return
  const { animation, interaction } = row.pair
  if (animation) {
    motion.stop(animation, animation.targetId ?? owner.id)
    animations.removeBinding(owner, animation.id)
  }
  if (interaction) interactions.removeBinding(owner, interaction.id)
  highlightElement(null)
  // the drawer holds the trigger open, and `rows` re-lists an open trigger as a
  // PENDING row — so a removal that left the drawer up put the row straight
  // back, reading as a delete that deleted nothing. Compared by trigger, never
  // by row identity: `rows` has already recomputed by the time this runs.
  if (drawerOpen.value && drawerTrigger.value === row.trigger) closeDrawer()
}

const totalActions = computed(() => actions.value.length)

const openRow = computed(() => {
  if (!drawerOpen.value || drawerView.value !== 'trigger' || !drawerTrigger.value) return null
  const here = rows.value.filter((r) => r.trigger === drawerTrigger.value)
  return here.find((r) => r.key === drawerAction.value) ?? here[0] ?? null
})

const addingTrigger = ref(false)

function addTrigger(trigger: string) {
  addingTrigger.value = false
  const made = createActionFor(trigger)
  openTrigger(trigger, made?.key || null)
}

const offered = UI_TRIGGERS

watch(
  () => target.value?.id,
  () => {
    addingTrigger.value = false
  },
)

const { pendingFocus } = usePanel()
const addButton = ref<InstanceType<typeof ButtonUI>>()
function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => addButton.value?.$el?.focus?.())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)
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

    <ButtonUI ref="addButton" variant="outline" size="sm" class="w-full" @click="toggleDrawer()">
      {{ drawerOpen ? 'Hide effects' : 'Open effects' }}
    </ButtonUI>
  </GroupPopover>

  <div v-else class="flex flex-col">
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
        @click="addingTrigger = !addingTrigger"
      >
        Trigger
      </ButtonUI>
    </div>

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

    <GroupPopover v-if="rows.length">
      <div
        v-for="row in rows"
        :key="row.key || row.trigger"
        data-trigger-item
        class="flex items-center gap-1"
      >
        <button
          type="button"
          data-trigger-row
          :aria-current="openRow === row ? 'true' : undefined"
          class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
          :class="openRow === row ? 'border-accent bg-accent/5' : 'border-input hover:border-accent'"
          @click="openTrigger(row.trigger, row.key || null)"
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

        <button
          v-if="row.pair"
          v-tooltip="{ text: 'Remove', side: 'left' }"
          type="button"
          data-trigger-remove
          aria-label="Remove"
          class="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-danger focus-visible:ring-2 focus-visible:ring-accent"
          @click="removeRow(row)"
        >
          <Trash2 class="size-3" />
        </button>
      </div>
    </GroupPopover>

    <GroupPopover v-else>
      <p class="text-xs text-muted-foreground">
        Nothing yet. Add a trigger to say when something happens.
      </p>
    </GroupPopover>

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
