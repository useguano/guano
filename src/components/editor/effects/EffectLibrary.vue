<script setup lang="ts">
// Every effect in the project, as one list.
//
// The two motion systems used to be two libraries in two sections, each
// labelled with its engine — which made choosing one a question about our
// implementation. Here they are sorted together by name: an effect is an
// effect, and what it does is visible the moment you select it.
import { CircleAlert, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffects, type LibraryItem } from '@/composables/useEffects'
import { useModal } from '@/composables/useModal'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'

const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const { confirm } = useModal()
const { selected, openEffect } = useEffectsDrawer()

/**
 * Names only — a named effect, plus every half no effect has claimed. The usage
 * count walks every page and master, so it is read per ROW in the template
 * rather than inside this computed, which would otherwise walk the whole
 * project just to sort the list.
 */
const items = effects.libraryItems

function usage(item: LibraryItem): number {
  if (item.kind === 'effect') {
    const effect = effects.effectById(item.id)
    return effect ? effects.usageCount(effect) : 0
  }
  return item.kind === 'interaction'
    ? interactions.usageCount(item.id)
    : animations.usageCount(item.id)
}

/** an invalid timeline applied nowhere has no row to report on it, so the
 *  library row is the only place its error can surface */
function errorFor(item: LibraryItem): string | null {
  const id =
    item.kind === 'animation'
      ? item.id
      : item.kind === 'effect'
        ? effects.effectById(item.id)?.animationId
        : undefined
  if (!id) return null
  const animation = animations.animationFor(id)
  return animation ? animations.animationError(animation) : null
}

async function remove(item: LibraryItem) {
  const used = usage(item)
  const ok = await confirm({
    title: 'Delete effect',
    message: used
      ? `Delete “${item.name}”? It is used on ${used} element${used === 1 ? '' : 's'}.`
      : `Delete “${item.name}”?`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  // the cascading delete also un-applies it from every element
  if (item.kind === 'effect') {
    const effect = effects.effectById(item.id)
    if (effect) effects.deleteEffect(effect)
  } else if (item.kind === 'interaction') {
    interactions.deleteInteraction(item.id)
  } else {
    animations.deleteAnimation(item.id)
  }
}

</script>

<template>
  <div class="flex min-h-0 flex-col">
    <p
      class="flex h-9 shrink-0 items-center px-3 section-label"
    >
      Effects
    </p>

    <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-1">
      <p v-if="!items.length" class="px-2 py-1 text-[10px] text-muted-foreground">
        No effects yet.
      </p>

      <div
        v-for="item in items"
        :key="item.id"
        data-effect-row
        class="group/row flex h-7 items-center gap-1 rounded-lg px-2"
        :class="selected?.id === item.id ? 'bg-accent/30' : 'hover:bg-accent/15'"
      >
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
          @click="openEffect(item.kind, item.id)"
        >
          {{ item.name }}
        </button>
        <CircleAlert
          v-if="errorFor(item)"
          v-tooltip="errorFor(item)!"
          class="size-3.5 shrink-0 text-danger"
        />
        <span class="shrink-0 text-[10px] text-muted-foreground tabular-nums">{{ usage(item) }}</span>
        <ButtonUI
          variant="icon"
          size="xs"
          :icon="Trash2"
          tooltip="Delete effect"
          class="w-5 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100"
          @click="remove(item)"
        />
      </div>
    </div>
  </div>
</template>
