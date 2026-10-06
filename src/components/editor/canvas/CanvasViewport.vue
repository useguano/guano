<script setup lang="ts">
// The infinite canvas: a viewport onto a "world" that pans and zooms. Shared by
// the page canvas and the components board, so both answer to the same
// gestures — scroll to pan, ⌘/ctrl+scroll or pinch to zoom, space+drag to pan,
// ⌘+ / ⌘- / ⌘0 from the keyboard.
//
// The default slot is the world (it receives `zoom`, for chrome that should
// stay a constant size on screen); the `overlay` slot is screen-space, for
// anything that must not move with the camera.
import { onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useKeymap, useShortcut } from '@/composables/useShortcut'

interface Camera {
  x: number
  y: number
  zoom: number
}

const props = withDefaults(
  defineProps<{
    /** where the camera starts, and where ⌘0 returns it */
    initial?: Camera
    /** cursor class while idle (e.g. a crosshair while picking a target) */
    cursor?: string
  }>(),
  { initial: () => ({ x: 80, y: 60, zoom: 0.3 }), cursor: '' },
)

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
// how much of the world must stay on screen, so it can't be panned out of reach
const PAN_MARGIN = 120

const camera = ref<Camera>({ ...props.initial })
const viewportEl = ref<HTMLElement>()
const worldEl = ref<HTMLElement>()
const space = useShortcut('Space')

const panning = ref(false)
let last = { x: 0, y: 0 }
let gesturing = false
let gestureScale = 1

function clampCamera(cam: Camera): Camera {
  const rect = viewportEl.value?.getBoundingClientRect()
  const world = worldEl.value
  if (!rect || !world) return cam
  const worldW = world.offsetWidth * cam.zoom
  const worldH = world.offsetHeight * cam.zoom
  cam.x = Math.min(rect.width - PAN_MARGIN, Math.max(PAN_MARGIN - worldW, cam.x))
  cam.y = Math.min(rect.height - PAN_MARGIN, Math.max(PAN_MARGIN - worldH, cam.y))
  return cam
}

function onPointerDown(e: PointerEvent) {
  if (!space.pressed.value) return
  panning.value = true
  last = { x: e.clientX, y: e.clientY }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!panning.value) return
  camera.value = clampCamera({
    zoom: camera.value.zoom,
    x: camera.value.x + (e.clientX - last.x),
    y: camera.value.y + (e.clientY - last.y),
  })
  last = { x: e.clientX, y: e.clientY }
}

function onPointerUp() {
  panning.value = false
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** zoom keeping the point under (cx, cy) — viewport coordinates — fixed */
function zoomAt(next: number, cx: number, cy: number) {
  const { x, y, zoom } = camera.value
  const z = clampZoom(next)
  camera.value = clampCamera({ zoom: z, x: cx - (cx - x) * (z / zoom), y: cy - (cy - y) * (z / zoom) })
}

function onWheel(e: WheelEvent) {
  if (gesturing) return
  const rect = viewportEl.value?.getBoundingClientRect()
  if (!rect) return
  if (e.ctrlKey || e.metaKey) {
    zoomAt(camera.value.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
  } else {
    camera.value = clampCamera({
      zoom: camera.value.zoom,
      x: camera.value.x - e.deltaX,
      y: camera.value.y - e.deltaY,
    })
  }
}

// Safari's pinch arrives as gesture events rather than ctrl+wheel
function onGestureStart(e: Event) {
  e.preventDefault()
  gesturing = true
  gestureScale = (e as unknown as { scale: number }).scale || 1
}
function onGestureChange(e: Event) {
  e.preventDefault()
  const rect = viewportEl.value?.getBoundingClientRect()
  const ev = e as unknown as { scale: number; clientX: number; clientY: number }
  if (!rect || !gestureScale) return
  const factor = ev.scale / gestureScale
  gestureScale = ev.scale
  zoomAt(camera.value.zoom * factor, ev.clientX - rect.left, ev.clientY - rect.top)
}
function onGestureEnd() {
  gesturing = false
}
onMounted(() => {
  viewportEl.value?.addEventListener('gesturestart', onGestureStart)
  viewportEl.value?.addEventListener('gesturechange', onGestureChange)
  viewportEl.value?.addEventListener('gestureend', onGestureEnd)
})
onBeforeUnmount(() => {
  viewportEl.value?.removeEventListener('gesturestart', onGestureStart)
  viewportEl.value?.removeEventListener('gesturechange', onGestureChange)
  viewportEl.value?.removeEventListener('gestureend', onGestureEnd)
})

function zoomBy(factor: number) {
  const rect = viewportEl.value?.getBoundingClientRect()
  if (!rect) return
  zoomAt(camera.value.zoom * factor, rect.width / 2, rect.height / 2)
}

useKeymap([
  { key: ['=', '+'], mod: true, allowInInput: true, handler: () => zoomBy(1.2) },
  { key: '-', mod: true, allowInInput: true, handler: () => zoomBy(1 / 1.2) },
  { key: '0', mod: true, allowInInput: true, handler: () => (camera.value = { ...props.initial }) },
])

// --- moving the camera to something ---

// a programmatic move glides; a gesture must not (it would lag the pointer)
const gliding = ref(false)
let glideTimer: ReturnType<typeof setTimeout> | undefined
function glide() {
  gliding.value = true
  clearTimeout(glideTimer)
  glideTimer = setTimeout(() => (gliding.value = false), 320)
}
onBeforeUnmount(() => clearTimeout(glideTimer))

/** centre the viewport on a WORLD point, optionally at a new zoom */
function centerOn(wx: number, wy: number, opts: { zoom?: number; animate?: boolean } = {}) {
  const rect = viewportEl.value?.getBoundingClientRect()
  if (!rect) return
  const zoom = clampZoom(opts.zoom ?? camera.value.zoom)
  if (opts.animate) glide()
  camera.value = clampCamera({ zoom, x: rect.width / 2 - wx * zoom, y: rect.height / 2 - wy * zoom })
}

/** an element's centre in world coordinates (null when it isn't in the world) */
function worldCenterOf(el: Element): { x: number; y: number; width: number; height: number } | null {
  const world = worldEl.value
  if (!world || !world.contains(el)) return null
  const w = world.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const { zoom } = camera.value
  return {
    x: (r.left - w.left + r.width / 2) / zoom,
    y: (r.top - w.top + r.height / 2) / zoom,
    width: r.width / zoom,
    height: r.height / zoom,
  }
}

/**
 * Bring an element to the centre of the viewport, zooming so it fits with
 * room to spare — but never zooming IN past `maxZoom`, so a small element
 * isn't blown up to fill the screen.
 */
function focusElement(el: Element, opts: { maxZoom?: number; padding?: number } = {}) {
  const rect = viewportEl.value?.getBoundingClientRect()
  const at = worldCenterOf(el)
  if (!rect || !at) return
  const padding = opts.padding ?? 160
  const fit = Math.min(
    (rect.width - padding) / Math.max(at.width, 1),
    (rect.height - padding) / Math.max(at.height, 1),
  )
  centerOn(at.x, at.y, { zoom: Math.min(fit, opts.maxZoom ?? 1), animate: true })
}

/**
 * The camera reaches the DOM imperatively, NOT through a `:style` binding.
 *
 * A pan replaces `camera.value` on every pointer/wheel event, so a binding
 * would make this component's render effect depend on it — and re-rendering
 * re-invokes the default slot, which is the whole world. On the components
 * board that is 40-odd live component trees: measured at 11ms a frame against
 * 0.2ms for the page canvas, i.e. most of a frame's budget spent diffing a
 * tree whose only change is a transform on its root. One style write costs
 * nothing, and nothing above it re-renders.
 *
 * `--cam-inv` (1 / zoom) rides along so chrome inside the world can
 * counter-scale in pure CSS — `scale(var(--cam-inv))` — rather than being
 * re-rendered once per zoom step.
 */
watchEffect(
  () => {
    const el = worldEl.value
    if (!el) return
    const { x, y, zoom } = camera.value
    el.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
    el.style.transition = gliding.value ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : ''
    el.style.setProperty('--cam-inv', String(1 / zoom))
  },
  // post, so the world element exists on the first run and the write lands in
  // the same task as the mount — there is no frame at an untransformed camera
  { flush: 'post' },
)

/**
 * The slot's `zoom` is for chrome that needs the NUMBER in JS (a comment pin).
 * It tracks the zoom alone, so a pan leaves it untouched and the slot — and
 * everything in it — does not re-render.
 */
const slotZoom = ref(camera.value.zoom)
watch(() => camera.value.zoom, (z) => (slotZoom.value = z))

defineExpose({ camera, viewportEl, worldEl, centerOn, focusElement })
</script>

<template>
  <div
    ref="viewportEl"
    class="relative h-full w-full touch-none overflow-hidden bg-secondary"
    :class="panning ? 'cursor-grabbing' : space.pressed.value ? 'cursor-grab' : cursor"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <!-- no :style here on purpose — the camera is written imperatively above,
         so panning never re-renders this component or its slot -->
    <div ref="worldEl" class="absolute top-0 left-0 origin-top-left">
      <slot :zoom="slotZoom" />
    </div>
    <slot name="overlay" />
  </div>
</template>
