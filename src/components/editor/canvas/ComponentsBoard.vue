<script setup lang="ts">
// What the canvas shows while the Components column is open: every component
// on one board, grouped by category, each rendered once in its own card and
// editable in place — select an element and the Style / Data / Interactions
// panels edit the component's master. Same infinite canvas as the pages
// (CanvasViewport): scroll to pan, ⌘+scroll or pinch to zoom, space+drag.
//
// Structure is editable too: an edit mutates the component's master and is
// pushed to every instance on every page. Inserting a component INTO a page
// still happens on the page, from the ⌘E dock.
import { computed, nextTick, ref, watch } from 'vue'
import CanvasViewport from '@/components/editor/canvas/CanvasViewport.vue'
import ElementRenderer from '@/components/editor/canvas/ElementRenderer.vue'
import VariantScope from '@/components/editor/canvas/VariantScope.vue'
import InsertDock from '@/components/editor/canvas/InsertDock.vue'
import { useComponentBoard, useComponentBoardSession } from '@/composables/useComponentBoard'
import type { BoardCard } from '@/composables/useComponentBoard'
import { useElement } from '@/composables/useElement'
import { useSettings } from '@/composables/useSettings'
import { useVariants } from '@/composables/useVariants'
import { useThemeTokens } from '@/composables/useThemeTokens'

void import('@tailwindcss/browser')
useThemeTokens()
useComponentBoardSession()

const { groups, focusRequest, focusedKey } = useComponentBoard()
const { selectElement } = useElement()
const { settings } = useSettings()
const { picksFor, activeDrawing, wear } = useVariants()

const isActive = (card: BoardCard, axis: string, option: string) =>
  activeDrawing(card.def) === `${axis}:${option}`

// A drawing is as wide as its component needs. Page furniture gets a desktop
// width; something that sizes itself (a button, a badge) gets no width at all,
// so six of them sit in a row instead of six columns of white; the rest gets
// the narrow card.
const SELF_SIZED = /(^| )(inline-flex|inline-block|inline|w-fit)( |$)/
function surfaceStyle(card: BoardCard) {
  const root = card.def.root.children[0]
  const classes = root?.classes ?? ''
  const selfSized =
    !!card.def.variants?.length && SELF_SIZED.test(classes) && !/(^| )w-full( |$)/.test(classes)
  return {
    width: isWide(card) ? `${WIDE}px` : selfSized ? undefined : `${NARROW}px`,
    fontFamily: settings.value.fonts.family || undefined,
    contain: 'layout',
  }
}

// cards are far smaller than page frames, so the board opens closer in
const INITIAL_CAMERA = { x: 60, y: 60, zoom: 0.6 }

// Labels hold their on-screen size against the zoom. This reads
// CanvasViewport's `--cam-inv` instead of the slot's `zoom`, so the camera
// never touches this component's render: a board of 40-odd component trees
// costs 11ms to re-render, which is most of a frame. A frozen object, so a
// re-render for some other reason still patches nothing.
const COUNTER_SCALE = Object.freeze({ transform: 'scale(var(--cam-inv, 1))' })

// page furniture spans the page, so it gets a desktop-width card; everything
// else sits in a narrow one and keeps its natural size
const WIDE_TYPES = ['section', 'header', 'footer', 'main']
const NARROW = 384
const WIDE = 1024
const isWide = (card: BoardCard) => WIDE_TYPES.includes(card.def.root.children[0]?.type ?? '')

// --- focus: a drawer row brings its card into view and selects it ---
const canvas = ref<InstanceType<typeof CanvasViewport>>()
const allCards = computed(() => groups.value.flatMap((g) => g.cards))

watch(
  () => focusRequest.value?.tick,
  async () => {
    const key = focusRequest.value?.key
    if (!key) return
    await nextTick()
    const el = canvas.value?.worldEl?.querySelector(`[data-board-card="${CSS.escape(key)}"]`)
    if (el) canvas.value?.focusElement(el)
    focusedKey.value = key
    // select what the component actually renders, so the panels are ready
    const card = allCards.value.find((c) => c.key === key)
    const first = card?.def.root.children[0]
    if (first) selectElement(first.id)
  },
)

function onBoardClick() {
  selectElement(null)
  focusedKey.value = null
}
</script>

<template>
  <CanvasViewport ref="canvas" :initial="INITIAL_CAMERA" @click="onBoardClick">
    <template #default>
      <!-- one row per category: an infinite canvas has no edge to wrap at -->
      <div class="flex w-max flex-col gap-24">
        <section v-for="group in groups" :key="group.name" class="flex flex-col gap-6">
          <!-- labels are scaled against the zoom so they stay readable, like
               the page canvas's frame labels -->
          <h2
            class="origin-bottom-left text-xs font-medium tracking-wide text-muted-foreground uppercase select-none"
            :style="COUNTER_SCALE"
          >
            {{ group.name }}
          </h2>
          <div class="flex w-max items-start gap-16">
            <div
              v-for="card in group.cards"
              :key="card.key"
              :data-board-card="card.key"
              class="flex flex-col gap-3"
            >
              <div
                class="flex origin-bottom-left items-center gap-2 text-[10px] whitespace-nowrap text-muted-foreground select-none"
                :style="COUNTER_SCALE"
              >
                <span :class="focusedKey === card.key ? 'font-medium text-foreground' : ''">
                  {{ card.def.name }}
                </span>
              </div>
              <!-- `contain: layout` makes the card the containing block for
                   position:fixed, so a dialog's overlay covers its own card
                   rather than the whole editor -->
              <!-- a component with variants is drawn once per option, side by
                   side: what it comes in is something to SEE, and the drawing
                   pointed at is the one the panels edit -->
              <div
                v-for="axis in card.def.variants ?? []"
                :key="axis.name"
                class="flex flex-col gap-3"
              >
                <span
                  class="origin-bottom-left text-[10px] whitespace-nowrap text-muted-foreground select-none"
                  :style="COUNTER_SCALE"
                >
                  {{ axis.name }}
                </span>
                <div class="flex items-start gap-8" :class="isWide(card) && 'flex-col'">
                  <div
                    v-for="option in axis.options"
                    :key="option"
                    :data-board-variant="`${card.def.name}:${axis.name}:${option}`"
                    :data-board-variant-active="isActive(card, axis.name, option) || undefined"
                    class="flex flex-col gap-2"
                    @pointerdown.capture="wear(card.def, axis.name, option)"
                  >
                    <span
                      class="origin-bottom-left text-[10px] whitespace-nowrap select-none"
                      :class="
                        isActive(card, axis.name, option)
                          ? 'font-medium text-foreground'
                          : 'text-muted-foreground'
                      "
                      :style="COUNTER_SCALE"
                    >
                      {{ option }}
                    </span>
                    <div
                      data-site-scope
                      data-board-card-surface
                      class="bg-white text-black shadow-lg"
                      :class="[
                        isWide(card) ? '' : 'p-6',
                        isActive(card, axis.name, option) && 'ring-2 ring-accent',
                      ]"
                      :style="surfaceStyle(card)"
                      @click.stop="focusedKey = card.key"
                    >
                      <VariantScope
                        :picks="picksFor(card.def, axis.name, option)"
                        :active="isActive(card, axis.name, option)"
                      >
                        <ElementRenderer :node="card.def.root" />
                      </VariantScope>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="!card.def.variants?.length"
                data-site-scope
                data-board-card-surface
                class="bg-white text-black shadow-lg"
                :class="isWide(card) ? '' : 'p-6'"
                :style="surfaceStyle(card)"
                @click.stop="focusedKey = card.key"
              >
                <ElementRenderer :node="card.def.root" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <template #overlay>
      <InsertDock />
    </template>
  </CanvasViewport>
</template>
