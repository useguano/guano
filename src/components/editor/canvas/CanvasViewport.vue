<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useKeymap, useShortcut } from '@/composables/useShortcut'

interface Camera {
  x: number
  y: number
  zoom: number
}

const props = withDefaults(
  defineProps<{
    initial?: Camera
    cursor?: string
  }>(),
  { initial: () => ({ x: 80, y: 60, zoom: 0.3 }), cursor: '' },
)

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
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

const gliding = ref(false)
let glideTimer: ReturnType<typeof setTimeout> | undefined
function glide() {
  gliding.value = true
  clearTimeout(glideTimer)
  glideTimer = setTimeout(() => (gliding.value = false), 320)
}
onBeforeUnmount(() => clearTimeout(glideTimer))

function centerOn(wx: number, wy: number, opts: { zoom?: number; animate?: boolean } = {}) {
  const rect = viewportEl.value?.getBoundingClientRect()
  if (!rect) return
  const zoom = clampZoom(opts.zoom ?? camera.value.zoom)
  if (opts.animate) glide()
  camera.value = clampCamera({ zoom, x: rect.width / 2 - wx * zoom, y: rect.height / 2 - wy * zoom })
}

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

watchEffect(
  () => {
    const el = worldEl.value
    if (!el) return
    const { x, y, zoom } = camera.value
    el.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
    el.style.transition = gliding.value ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : ''
    el.style.setProperty('--cam-inv', String(1 / zoom))
  },
  { flush: 'post' },
)

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

    <div ref="worldEl" class="absolute top-0 left-0 origin-top-left">
      <slot :zoom="slotZoom" />
    </div>
    <slot name="overlay" />
  </div>
</template>
