<script setup lang="ts">
// The full-site live preview used inside the editor shell's Preview mode:
// the site rendered as one navigable full-width column (no breakpoint frames).
// For an admin or editor it is READ-ONLY — the site as a visitor gets it, with
// links, interactions and motion running for real; content is edited on the
// Edit surface. A contributor (pinned here) also edits content in place: see
// usePreviewEditing, whose "Edit content" menu is rendered below. Anyone can
// review: hold C and click to drop a comment.
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

// runtime Tailwind so class strings typed in the editor compile in the preview
void import('@tailwindcss/browser')

const { activePage } = usePage()
const { collections, activeCollection, activeEntry } = useCollections()
const { project } = useProject()
const { addComment, activeComment, focusTick } = useComments()

// C toggles the comment-drop tool (Esc exits); click drops a comment pinned
// to the element under the cursor
const { commentMode } = useCommentMode()
const mainEl = ref<HTMLElement>()

// the contributor's "Edit content" menu (opened by a renderer's contextmenu)
const { contentEditing, menu, closeMenu, requestEdit } = usePreviewEditing()
// Escape closes it — capture-phase and stopped, so it peels this one layer
// rather than reaching the editor's own Escape handlers
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
// opened at the pointer, then pulled back inside the viewport once its size is
// known — a right-click near the bottom or right edge would otherwise put it
// off-screen
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
// `main` is overflow-hidden (fixed-child containment); this inner wrapper is
// what actually scrolls, so scrub progress measures against it
const scrollEl = ref<HTMLElement>()

function onPreviewClick(e: MouseEvent) {
  if (!commentMode.value || !mainEl.value) return
  const anchor = anchorFromPoint(e.clientX, e.clientY, mainEl.value)
  if (!anchor) return
  e.preventDefault()
  e.stopPropagation() // capture-phase: beat the renderer's navigation click
  addComment({ pageId: activePage.value.id, anchor })
}

// --- scroll-driven (scrub) animations ---
// Preview is the only editor surface with a real scroll container (the canvas
// frames don't scroll), so this is where scrub bindings can be previewed for
// real. The published site does the same thing against the window.
const { animationFor } = useAnimation()
const motion = useMotion()

/** every scrub binding on the page, with the node its animation moves.
 * ownerId is the node the binding LIVES on — progress is measured against the
 * owner's viewport position (it is the scroll trigger), exactly like the
 * published runtime; targetId is only where the values land. Measuring the
 * target instead diverges as soon as targetId points elsewhere (a marker
 * driving a pinned stage). */
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
    // top relative to the scroll container, so progress matches what the
    // viewer sees rather than the document
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top
    motion.scrubTo(binding, animation, targetId, motion.scrubProgressFor(binding, top, vh))
  }
}
function onScroll() {
  // scrolled by anything other than our own lerp (scrollbar, keyboard, a
  // scrollIntoView)? that position becomes the scroller's new starting point
  if (scroller && Math.abs((scrollEl.value?.scrollTop ?? 0) - ownWrite) > 1) scroller.sync()
  if (scrubFrame === null) scrubFrame = requestAnimationFrame(updateScrub)
}

// --- smooth (inertia) scrolling ---
// The same shared scroller the published site uses, over this pane's own
// overflow container instead of the window — Preview is where the site's feel
// gets judged, so it has to feel like the published site. The Build canvas has
// nothing to apply it to: it pans a transformed world, it never scrolls.

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
  // scrub in the same frame we scrolled in, so parallax can't lag the page
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

// the intensity setting is baked into the scroller, so drop it when it changes
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
// a page switch re-seats every scrub binding at its scroll position
watch(() => activePage.value.id, () => void nextTick(updateScrub))

// clicking a comment in the list scrolls the preview to its anchored element
watch(focusTick, async () => {
  await nextTick()
  const anchor = activeComment.value?.anchor
  if (!anchor || !mainEl.value) return
  mainEl.value
    .querySelector(`[data-node-id="${anchor.nodeId}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

// design tokens + Google Fonts for the preview
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
    <!-- This pane IS the site's viewport, and it has to behave like one on two
         axes:
         · `isolate` traps the site in its own stacking context, so a user
           element's z-index (even a fixed one at z-100000000) can never paint
           over the editor chrome (pages drawer, rail, sidebar).
         · `contain-paint` makes it the containing block for `position: fixed`
           descendants, so a fixed header/nav/cookie bar spans THIS pane rather
           than the browser window — otherwise it slid under the left rail and
           over the right sidebar.
         The containment must sit on a NON-scrolling element with the scrolling
         moved to the wrapper below: put both on one element and fixed children
         are confined but scroll away with the content, which is worse than the
         original bug (a "fixed" header would visibly scroll off). -->
    <main
      ref="mainEl"
      data-site-scope
      class="isolate h-full overflow-hidden contain-paint bg-white font-sans text-black select-text"
      :class="commentMode && 'cursor-crosshair'"
      :style="fontStyle"
      @click.capture="onPreviewClick"
    >
      <!-- `custom-scrollbar`: the pane is the one place a native scrollbar
           would show up inside the site's own white ground, where its track
           read as a pale gutter down the edge of the page. Same thin
           transparent-track bar the rest of the chrome uses. -->
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

    <!-- floating comment pins over the preview -->
    <CommentLayer :root="mainEl ?? null" />

    <!-- a contributor's "Edit content" context menu — teleported, since the
         pane's containment would make `fixed` mean the pane, not the viewport,
         and the menu sits at the pointer's viewport coordinates -->
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
