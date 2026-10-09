<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import { usePage } from '@/composables/usePage'
import { useProject, MIN_BREAKPOINTS } from '@/composables/useProject'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import CanvasViewport from '@/components/editor/canvas/CanvasViewport.vue'
import ElementRenderer from '@/components/editor/canvas/ElementRenderer.vue'
import FrameScope from '@/components/editor/canvas/FrameScope.vue'
import EntryScope from '@/components/shared/EntryScope.vue'
import CommentMarker from '@/components/shared/CommentMarker.vue'
import CommentLayer from '@/components/site/CommentLayer.vue'
import { anchorFromPoint, anchorScreenPos } from '@/lib/commentAnchor'
import InsertDock from '@/components/editor/canvas/InsertDock.vue'
import { useCollections } from '@/composables/useCollections'
import { useComments } from '@/composables/useComments'
import { useCommentMode } from '@/composables/useCommentMode'
import { useInteraction } from '@/composables/useInteraction'
import { useSettings } from '@/composables/useSettings'
import { useThemeTokens } from '@/composables/useThemeTokens'
import type { Breakpoint } from '@/types/editor'

void import('@tailwindcss/browser')

const { activePage } = usePage()
const { breakpoints, canAddBreakpoint, addBreakpoint, removeBreakpoint, setActiveBreakpoint } = useProject()

const canRemoveBreakpoint = computed(() => breakpoints.value.length > MIN_BREAKPOINTS)
const { visibleComments, addComment, activeComment, focusTick } = useComments()
const { pickingFor } = useInteraction()
const { activeCollection, activeEntry } = useCollections()
const { settings } = useSettings()
useThemeTokens() 

const vp = ref<InstanceType<typeof CanvasViewport>>()
const viewport = computed(() => vp.value?.viewportEl ?? null)
const { commentMode } = useCommentMode()

const pageComments = computed(() => visibleComments(activePage.value.id))

const frameEls: Record<string, HTMLElement> = {}
function setFrameEl(id: string) {
  return (el: unknown) => {
    if (el instanceof HTMLElement) frameEls[id] = el
  }
}

function placeComment(e: MouseEvent) {
  if (!commentMode.value || !viewport.value) return
  const anchor = anchorFromPoint(e.clientX, e.clientY, viewport.value)
  if (anchor) addComment({ pageId: activePage.value.id, anchor })
}

function onFrameClick(bp: Breakpoint, e: MouseEvent) {
  setActiveBreakpoint(bp.id)
  if (!commentMode.value) return
  e.stopPropagation()
  placeComment(e)
}
const onCanvasClick = placeComment

watch(focusTick, async () => {
  await nextTick()
  const comment = activeComment.value
  const canvas = vp.value
  if (!comment || !canvas?.viewportEl) return
  const { x: camX, y: camY, zoom } = canvas.camera
  const rect = canvas.viewportEl.getBoundingClientRect()

  if (comment.anchor && canvas.worldEl) {
    const pos = anchorScreenPos(comment.anchor, canvas.worldEl)
    if (!pos) return
    canvas.centerOn((pos.x - rect.left - camX) / zoom, (pos.y - rect.top - camY) / zoom)
    return
  }

  if (comment.x === undefined || comment.y === undefined) return
  let x = comment.x
  let y = comment.y
  if (comment.breakpointId) {
    const frame = frameEls[comment.breakpointId]
    if (!frame) return
    x += frame.offsetLeft
    y += frame.offsetTop
  }
  canvas.centerOn(x, y)
})
</script>

<template>
  <CanvasViewport
    ref="vp"
    :cursor="commentMode || pickingFor ? 'cursor-crosshair' : ''"
    @click="onCanvasClick"
  >
    <template #default="{ zoom }">
      <div class="flex w-max items-stretch">
        <template v-for="(bp, i) in breakpoints" :key="bp.id">
          <div class="group flex w-40 items-start justify-center" @click.stop>
            <div v-if="canAddBreakpoint(i)" class="origin-top" :style="{ transform: `scale(${1 / zoom})` }">
              <ButtonUI
                variant="ghost"
                size="sm"
                :icon="Plus"
                tooltip="Add breakpoint"
                class="size-8 rounded-full bg-background opacity-50 shadow-md transition-opacity group-hover:opacity-100"
                @click="addBreakpoint(i)"
              />
            </div>
          </div>

          <div class="group/frame">
            <div
              class="mb-3 flex origin-bottom-left items-center text-[10px] gap-2 text-muted-foreground select-none"
              :style="{ transform: `scale(${1 / zoom})` }"
            >
              {{ bp.name }} · {{ bp.width }}
              <button
                v-if="canRemoveBreakpoint"
                v-tooltip="'Delete breakpoint'"
                class="cursor-pointer opacity-0 transition-opacity group-hover/frame:opacity-100 hover:text-foreground"
                @click.stop="removeBreakpoint(bp.id)"
              >
                <X class="size-3" />
              </button>
            </div>

          <div :ref="setFrameEl(bp.id)" class="relative">
            <div
              data-frame-drop
              data-site-scope
              :data-breakpoint-id="bp.id"
              class="flex flex-col overflow-hidden bg-white text-black shadow-lg"
              :style="{
                width: `${bp.width}px`,
                minHeight: `${bp.height}px`,
                fontFamily: settings.fonts.family || undefined,
                contain: 'layout',
              }"
              @click.capture="onFrameClick(bp, $event)"
            >

              <FrameScope :breakpoint-id="bp.id">
                <EntryScope
                  v-if="activeCollection"
                  :collection="activeCollection"
                  :entry="activeEntry"
                >
                  <ElementRenderer
                    v-for="node in activePage.elements"
                    :key="node.id"
                    :node="node"
                  />
                </EntryScope>
                <template v-else>
                  <ElementRenderer
                    v-for="node in activePage.elements"
                    :key="node.id"
                    :node="node"
                  />
                </template>
              </FrameScope>
            </div>
            <div
              v-for="comment in pageComments.filter((c) => c.breakpointId === bp.id)"
              :key="comment.id"
              class="absolute"
              :style="{ left: `${comment.x}px`, top: `${comment.y}px` }"
            >
              <CommentMarker :comment="comment" :zoom="zoom" />
            </div>
          </div>
          </div>
        </template>

        <div class="group flex w-40 items-center justify-center" @click.stop>
          <div
            v-if="canAddBreakpoint(breakpoints.length)"
            :style="{ transform: `scale(${1 / zoom})` }"
          >
            <ButtonUI
              variant="outline"
              size="sm"
              :icon="Plus"
              tooltip="Add breakpoint"
              class="size-8 rounded-full bg-background opacity-0 shadow-md transition-opacity group-hover:opacity-100"
              @click="addBreakpoint(breakpoints.length)"
            />
          </div>
        </div>
      </div>

      <div
        v-for="comment in pageComments.filter((c) => !c.breakpointId && !c.anchor)"
        :key="comment.id"
        class="absolute"
        :style="{ left: `${comment.x}px`, top: `${comment.y}px` }"
      >
        <CommentMarker :comment="comment" :zoom="zoom" />
      </div>
    </template>

    <template #overlay>
      <CommentLayer :root="viewport" />
      <InsertDock />
    </template>
  </CanvasViewport>
</template>
