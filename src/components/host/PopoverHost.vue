<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toValue, unref, watch } from 'vue'
import HostPopover from '@/components/popover/HostPopover.vue'
import { usePopover } from '@/composables/usePopover'
import { useModal } from '@/composables/useModal'
import { useInsertDrag } from '@/composables/useInsertDrag'
import { computeFloatingPosition } from '@/lib/floating'

const { current, closePopover } = usePopover()
const { stack: modalStack } = useModal()
const { payload: insertDrag, suppressNextClick } = useInsertDrag()

const panelEl = ref<HTMLElement>()
const style = ref<{ left: string; top: string; visibility: 'hidden' | 'visible' }>({
  left: '0px',
  top: '0px',
  visibility: 'hidden',
})

// grow the popover out of the corner nearest its anchor (InsertDock's
// origin-bottom-left trick, generalized to any placement): main axis toward
// the anchor, cross axis toward the aligned edge. Held in a ref (not a
// computed off `current`) so it survives the leave animation — `current` is
// already null by then, and a recompute would snap the origin to center.
const transformOrigin = ref('50% 50%')
function originFor(placement: string): string {
  const [side, align = 'center'] = placement.split('-')
  const cross = align === 'start' ? '0%' : align === 'end' ? '100%' : '50%'
  if (side === 'left') return `100% ${cross}`
  if (side === 'right') return `0% ${cross}`
  if (side === 'top') return `${cross} 100%`
  return `${cross} 0%` // bottom
}

// rAF loop: the anchor moves under us (canvas pan/zoom, scrolling), so track
// its live rect every frame and only write style when the position changes
// (CommentLayer pattern). getBoundingClientRect is immune to ancestor
// transforms, so zoomed-canvas anchors need no special math.
let raf = 0
let last = ''
function track() {
  raf = 0
  const state = current.value
  const el = panelEl.value
  if (!state) return
  if (!state.anchor.isConnected) {
    closePopover()
    return
  }
  if (el) {
    const { left, top } = computeFloatingPosition(
      state.anchor.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      { placement: state.placement, offset: state.offset ?? 8 },
    )
    const key = `${left},${top}`
    if (key !== last) {
      last = key
      style.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
    }
  }
  raf = requestAnimationFrame(track)
}

watch(current, async (state) => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  last = ''
  if (!state) return
  transformOrigin.value = originFor(state.placement)
  // render hidden for one frame so the panel can be measured before placing
  style.value = { left: '0px', top: '0px', visibility: 'hidden' }
  await nextTick()
  track()
})

// Escape closes the popover unless a modal is above it, a palette drag is
// being cancelled, or the popover opted out (the sidebar panel owns its own
// Escape → close + refocus-editor flow)
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const state = current.value
  if (!state || state.closeOnEscape === false) return
  if (modalStack.value.length || insertDrag.value) return
  closePopover()
}

// outside-click close is opt-in; the release click of a palette drag never counts
function onDocClick(e: MouseEvent) {
  const state = current.value
  if (!state?.closeOnOutside) return
  if (suppressNextClick.value) return
  const t = e.target as Node
  if (panelEl.value?.contains(t) || state.anchor.contains(t)) return
  closePopover()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <!-- same grow-in/out as the InsertDock panel (scale + fade from the anchor
       corner); transform-origin points at the anchor via transformOrigin -->
  <Transition name="pop">
    <div v-if="current" ref="panelEl" class="fixed z-50" :style="[style, { transformOrigin }]">
      <!-- icon resolves via unref, not toValue — a lucide icon is a bare
           function and toValue would call it (→ "slots of undefined" crash) -->
      <HostPopover :title="toValue(current.title)" :icon="unref(current.icon)" @close="closePopover()">
        <component :is="current.component" v-bind="current.props" />
      </HostPopover>
    </div>
  </Transition>
</template>

<style scoped>
.pop-enter-active,
.pop-leave-active {
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.15s ease;
}
.pop-enter-from,
.pop-leave-to {
  transform: scale(0.9);
  opacity: 0;
}
</style>
