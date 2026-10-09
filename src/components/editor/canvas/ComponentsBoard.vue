<script setup lang="ts">
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

const INITIAL_CAMERA = { x: 60, y: 60, zoom: 0.6 }

const COUNTER_SCALE = Object.freeze({ transform: 'scale(var(--cam-inv, 1))' })

const WIDE_TYPES = ['section', 'header', 'footer', 'main']
const NARROW = 384
const WIDE = 1024
const isWide = (card: BoardCard) => WIDE_TYPES.includes(card.def.root.children[0]?.type ?? '')

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
      <div class="flex w-max flex-col gap-24">
        <section v-for="group in groups" :key="group.name" class="flex flex-col gap-6">

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
