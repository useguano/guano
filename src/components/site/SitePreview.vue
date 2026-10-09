<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PreviewRenderer from '@/components/site/PreviewRenderer.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { ImageUp, PenLine } from 'lucide-vue-next'
import { usePreviewEditing } from '@/composables/usePreviewEditing'
import CommentLayer from '@/components/site/CommentLayer.vue'
import EntryScope from '@/components/shared/EntryScope.vue'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useProject } from '@/composables/useProject'
import { useThemeTokens } from '@/composables/useThemeTokens'
import { useComments } from '@/composables/useComments'
import { useCommentMode } from '@/composables/useCommentMode'
import { anchorFromPoint } from '@/lib/commentAnchor'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { reducedMotion, SCROLL_LERP_DEFAULT } from '@/lib/motion'
import { createLerpScroller, wheelDeltaPx, insideNestedScroller } from '@/lib/shared/scroll.js'
import { walkNodes } from '@/lib/tree'

void import('@tailwindcss/browser')

const { activePage } = usePage()
const { collections, activeCollection, activeEntry } = useCollections()
const { project } = useProject()
const { addComment, activeComment, focusTick } = useComments()

const { commentMode } = useCommentMode()
const mainEl = ref<HTMLElement>()

const { contentEditing, menu, closeMenu, requestEdit } = usePreviewEditing()
function onMenuKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !menu.value) return
  e.preventDefault()
  e.stopPropagation()
  closeMenu()
}
watch(
  () => !!menu.value,
  (open) => {
    if (open) window.addEventListener('keydown', onMenuKeydown, true)
    else window.removeEventListener('keydown', onMenuKeydown, true)
  },
)
const menuEl = ref<HTMLElement>()
const menuPos = ref({ x: 0, y: 0 })
watch(menu, async (m) => {
  if (!m) return
  menuPos.value = { x: m.x, y: m.y }
  await nextTick()
  const rect = menuEl.value?.getBoundingClientRect()
  if (!rect) return
  const margin = 8
  menuPos.value = {
    x: Math.max(margin, Math.min(m.x, window.innerWidth - rect.width - margin)),
    y: Math.max(margin, Math.min(m.y, window.innerHeight - rect.height - margin)),
  }
})
const scrollEl = ref<HTMLElement>()

function onPreviewClick(e: MouseEvent) {
  if (!commentMode.value || !mainEl.value) return
  const anchor = anchorFromPoint(e.clientX, e.clientY, mainEl.value)
  if (!anchor) return
  e.preventDefault()
  e.stopPropagation()
  addComment({ pageId: activePage.value.id, anchor })
}

const { animationFor } = useAnimation()
const motion = useMotion()

const scrubBindings = computed(() => {
  const list: {
    ownerId: string
    targetId: string
    binding: import('@/types/editor').AnimationBinding
  }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.animations ?? []) {
      if (binding.trigger === 'scrub') {
        list.push({ ownerId: node.id, targetId: binding.targetId ?? node.id, binding })
      }
    }
  })
  return list
})

let scrubFrame: number | null = null
function updateScrub() {
  scrubFrame = null
  const root = scrollEl.value
  if (!root || !scrubBindings.value.length) return
  const vh = root.clientHeight
  for (const { ownerId, targetId, binding } of scrubBindings.value) {
    const animation = animationFor(binding.animationId)
    if (!animation) continue
    const el = root.querySelector(`[data-node-id="${ownerId}"]`)
    if (!el) continue
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top
    motion.scrubTo(binding, animation, targetId, motion.scrubProgressFor(binding, top, vh))
  }
}
function onScroll() {
  if (scroller && Math.abs((scrollEl.value?.scrollTop ?? 0) - ownWrite) > 1) scroller.sync()
  if (scrubFrame === null) scrubFrame = requestAnimationFrame(updateScrub)
}

const smoothEnabled = computed(
  () => !!project.value.settings.motion?.scroll?.enabled && !reducedMotion(),
)
let scroller: ReturnType<typeof createLerpScroller> | null = null
let smoothFrame: number | null = null
let lastFrame = 0
let ownWrite = 0

function smoothStep(now: number) {
  const dt = lastFrame ? now - lastFrame : 16
  lastFrame = now
  const moving = scroller!.step(dt)
  ownWrite = scrollEl.value?.scrollTop ?? 0
  updateScrub()
  smoothFrame = moving ? requestAnimationFrame(smoothStep) : ((lastFrame = 0), null)
}

function onWheel(event: WheelEvent) {
  const root = scrollEl.value
  if (!smoothEnabled.value || !root || event.ctrlKey) return
  if (insideNestedScroller(event.target as Element | null, root, event.deltaY)) return
  event.preventDefault()
  if (!scroller) {
    scroller = createLerpScroller({
      get: () => root.scrollTop,
      set: (n) => (root.scrollTop = n),
      max: () => Math.max(0, root.scrollHeight - root.clientHeight),
      lerp: project.value.settings.motion?.scroll?.lerp ?? SCROLL_LERP_DEFAULT,
    })
  }
  scroller.wheel(wheelDeltaPx(event.deltaY, event.deltaMode, root.clientHeight))
  if (smoothFrame === null) {
    lastFrame = 0
    smoothFrame = requestAnimationFrame(smoothStep)
  }
}

watch(
  () => [smoothEnabled.value, project.value.settings.motion?.scroll?.lerp],
  () => {
    scroller = null
  },
)

onMounted(() => {
  scrollEl.value?.addEventListener('scroll', onScroll, { passive: true })
  scrollEl.value?.addEventListener('wheel', onWheel, { passive: false })
  void nextTick(updateScrub)
})
onBeforeUnmount(() => {
  closeMenu()
  window.removeEventListener('keydown', onMenuKeydown, true)
  scrollEl.value?.removeEventListener('scroll', onScroll)
  scrollEl.value?.removeEventListener('wheel', onWheel)
  if (scrubFrame !== null) cancelAnimationFrame(scrubFrame)
  if (smoothFrame !== null) cancelAnimationFrame(smoothFrame)
})
watch(() => activePage.value.id, () => void nextTick(updateScrub))

watch(focusTick, async () => {
  await nextTick()
  const anchor = activeComment.value?.anchor
  if (!anchor || !mainEl.value) return
  mainEl.value
    .querySelector(`[data-node-id="${anchor.nodeId}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

useThemeTokens()

const templateCollection = computed(() =>
  activePage.value.collectionId
    ? (collections.value.find((c) => c.id === activePage.value.collectionId) ?? null)
    : null,
)

const fontStyle = computed(() => ({
  fontFamily: project.value.settings.fonts.family || undefined,
}))
</script>

<template>
  <div class="relative h-full">

    <main
      ref="mainEl"
      data-site-scope
      class="isolate h-full overflow-hidden contain-paint bg-white font-sans text-black select-text"
      :class="commentMode && 'cursor-crosshair'"
      :style="fontStyle"
      @click.capture="onPreviewClick"
    >

      <div ref="scrollEl" class="custom-scrollbar h-full overflow-auto">
        <div class="flex min-h-full flex-col">
          <EntryScope
            v-if="activeEntry && activeCollection"
            :collection="activeCollection"
            :entry="activeEntry"
          >
            <PreviewRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
          </EntryScope>
          <EntryScope v-else-if="templateCollection" :collection="templateCollection" :entry="null">
            <PreviewRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
          </EntryScope>
          <template v-else>
            <PreviewRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
          </template>
        </div>
      </div>
    </main>

    <CommentLayer :root="mainEl ?? null" />

    <Teleport v-if="menu && contentEditing" to="body">
      <div class="fixed inset-0 z-[90]" @click="closeMenu" @contextmenu.prevent="closeMenu" />
      <div
        ref="menuEl"
        class="fixed z-[91] flex min-w-40 flex-col rounded-xl border border-input bg-background p-1 shadow-lg"
        :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
      >
        <ButtonUI
          v-if="menu.content"
          variant="ghost"
          size="sm"
          :icon="PenLine"
          class="w-full justify-start"
          @click="requestEdit(menu.nodeId, 'content')"
        >
          Edit content
        </ButtonUI>
        <ButtonUI
          v-if="menu.background"
          variant="ghost"
          size="sm"
          :icon="ImageUp"
          class="w-full justify-start"
          @click="requestEdit(menu.nodeId, 'background')"
        >
          Replace background
        </ButtonUI>
      </div>
    </Teleport>
  </div>
</template>
