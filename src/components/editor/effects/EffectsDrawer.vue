<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { X, Zap } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import EffectBody from '@/components/editor/effects/EffectBody.vue'
import EffectLibrary from '@/components/editor/effects/EffectLibrary.vue'
import TriggerEditor from '@/components/editor/effects/TriggerEditor.vue'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { useElementEffects } from '@/composables/useElementEffects'
import { useInteraction } from '@/composables/useInteraction'
import { useModal } from '@/composables/useModal'
import { usePopover } from '@/composables/usePopover'
import { isEditable } from '@/composables/useShortcut'
import { triggerOrder, triggerSentence, uiTrigger } from '@/lib/effectTriggers'

const { open, selected, trigger, view, openTrigger, closeDrawer } = useEffectsDrawer()
const interactions = useInteraction()
const { canEdit, elementLabel, sections } = useElementEffects()

const triggerRows = computed(() => {
  if (!canEdit.value) return []
  const list = sections.value.map((s) => ({ trigger: s.trigger, count: s.rows.length }))
  if (trigger.value && !list.some((r) => r.trigger === trigger.value)) {
    list.push({ trigger: trigger.value, count: 0 })
  }
  return list.sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger))
})

function onKeydownCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  if (interactions.pickingFor.value) return
  if (useModal().stack.value.length) return
  if (usePopover().current.value?.closeOnEscape !== false) return
  if (isEditable(document.activeElement)) return
  e.stopPropagation()
  closeDrawer()
}
onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydownCapture, true))
</script>

<template>
  <section
    v-if="open"
    data-effects-drawer
    class="flex h-72 min-h-0 shrink-0 border-t border-input bg-background"
  >
    <aside class="flex w-52 shrink-0 flex-col border-r border-input">
      <div v-if="triggerRows.length" class="flex shrink-0 flex-col border-b border-input">
        <p
          class="flex h-9 shrink-0 items-center gap-1 px-3 section-label"
        >
          <span class="shrink-0">Element</span>
          <span class="min-w-0 truncate normal-case tracking-normal">· {{ elementLabel }}</span>
        </p>
        <div class="flex flex-col px-1 pb-1.5">
          <button
            v-for="row in triggerRows"
            :key="row.trigger"
            type="button"
            data-drawer-trigger
            :aria-current="view === 'trigger' && trigger === row.trigger ? 'true' : undefined"
            class="flex h-7 items-center gap-1.5 rounded-lg px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
            :class="
              view === 'trigger' && trigger === row.trigger ? 'bg-accent/30' : 'hover:bg-accent/15'
            "
            @click="openTrigger(row.trigger)"
          >
            <component
              :is="uiTrigger(row.trigger)?.icon ?? Zap"
              class="size-3.5 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 flex-1 truncate">{{ triggerSentence(row.trigger) }}</span>
            <span v-if="!row.count" class="shrink-0 text-[10px] text-muted-foreground">empty</span>
          </button>
        </div>
      </div>

      <EffectLibrary class="min-h-0 flex-1" />
    </aside>

    <TriggerEditor v-if="view === 'trigger'" :trigger="trigger!" />

    <div v-else class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-9 shrink-0 items-center gap-2 border-b border-input px-2">
        <p class="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
          {{
            selected
              ? 'Shared by every element using it.'
              : canEdit
                ? 'Pick a trigger or an effect on the left.'
                : 'Pick an effect on the left.'
          }}
        </p>

        <div class="ml-auto flex shrink-0 items-center gap-1">
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="X"
            aria-label="Close effects"
            class="w-7 text-muted-foreground"
            @click="closeDrawer()"
          />
        </div>
      </header>

      <div class="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <EffectBody v-if="selected" :kind="selected.kind" :id="selected.id" />
      </div>

    </div>
  </section>
</template>
