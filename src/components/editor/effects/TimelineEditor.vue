<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ChevronRight, Copy, Plus, Settings2, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import TrackSettingsPopover from '@/components/editor/effects/TrackSettingsPopover.vue'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { usePopover } from '@/composables/usePopover'
import { compileAnimation, EASING_NAMES, MOTION_PROPS } from '@/lib/motion'
import {
  addTrack,
  duplicateTrack,
  removeTrack,
  trackSummary,
} from '@/components/editor/effects/trackOps'
import type { AnimationStep, AnimationTrack } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

const collapsed = reactive(new Set<string>())

const props = defineProps<{ id: string }>()

const { animationFor, animationError } = useAnimation()
const { previewTime } = useMotion()
const { openPopover } = usePopover()

const animation = computed(() => animationFor(props.id))

const ROW_GRID = 'grid grid-cols-[13rem_minmax(0,1fr)] items-center gap-2'

const LANE_LEFT = '14rem'
const LANE_INSET = '14.5rem'

const headTime = computed(() => previewTime(props.id) ?? 0)
const headLeft = computed(() => {
  const at = Math.max(0, Math.min(pct(headTime.value), 100)) / 100
  return `calc(${LANE_LEFT} + (100% - ${LANE_INSET}) * ${at})`
})

const EASING_OPTIONS = EASING_NAMES.map((e) => ({ label: e, value: e }))

const compiled = computed(() => (animation.value ? compileAnimation(animation.value) : null))

const liveSpan = computed(() => Math.max(compiled.value?.duration ?? 0, 400))

const frozenSpan = ref<number | null>(null)
const span = computed(() => frozenSpan.value ?? liveSpan.value)

const pct = (ms: number) => (span.value <= 0 ? 0 : (ms / span.value) * 100)

const TICK_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 5000]
const tickStep = computed(() => TICK_STEPS.find((s) => span.value / s <= 8) ?? 10000)
const gridStyle = computed(() => {
  const every = pct(tickStep.value)
  if (every <= 0) return {}
  return {
    backgroundImage: `repeating-linear-gradient(to right, var(--color-input) 0 1px, transparent 1px ${every}%)`,
  }
})

const ticks = computed(() => {
  const out: number[] = []
  for (let t = 0; t <= span.value; t += tickStep.value) out.push(t)
  return out
})

const selectedStep = ref(0)
watch(
  () => props.id,
  () => (selectedStep.value = 0),
)
watch(
  () => animation.value?.steps.length ?? 0,
  (n) => {
    if (selectedStep.value >= n) selectedStep.value = Math.max(0, n - 1)
  },
)

const step = computed<AnimationStep | null>(() => animation.value?.steps[selectedStep.value] ?? null)

const spans = computed(() => {
  const map = new Map<number, { start: number; duration: number; stagger: number; easing: string }>()
  for (const track of compiled.value?.tracks ?? []) {
    if (map.has(track.stepIndex)) continue
    map.set(track.stepIndex, {
      start: track.start,
      duration: track.duration,
      stagger: track.stagger,
      easing: track.easing,
    })
  }
  return map
})

interface TrackRow {
  key: string
  stepIndex: number
  trackIndex: number
  step: AnimationStep
  track: AnimationTrack
  start: number
  duration: number
  stagger: number
  easing: string
}

const rows = computed<TrackRow[]>(() => {
  const out: TrackRow[] = []
  const steps = animation.value?.steps ?? []
  for (let si = 0; si < steps.length; si++) {
    const owner = steps[si]
    const bar = spans.value.get(si)
    if (!owner || !bar) continue
    owner.tracks.forEach((track, ti) => {
      if (!MOTION_PROPS[track.prop]) return
      out.push({
        key: `${owner.id}-${ti}-${track.prop}`,
        stepIndex: si,
        trackIndex: ti,
        step: owner,
        track,
        ...bar,
      })
    })
  }
  return out
})

const groups = computed(() =>
  (animation.value?.steps ?? []).map((step, index) => ({
    step,
    index,
    open: !collapsed.has(step.id),
    bar: spans.value.get(index) ?? null,
    rows: rows.value.filter((row) => row.stepIndex === index),
  })),
)

function toggleStep(id: string) {
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
}

const dragging = ref(false)

function onBarDown(event: PointerEvent, stepIndex: number, mode: 'move' | 'resize') {
  const handle = event.currentTarget as HTMLElement
  const area = handle.closest('[data-track-area]') as HTMLElement | null
  const target = animation.value?.steps[stepIndex]
  if (!area || !target) return
  const width = area.getBoundingClientRect().width
  if (width <= 0) return

  selectedStep.value = stepIndex
  event.preventDefault()

  const msPerPx = span.value / width
  const startX = event.clientX
  const baseOffset = target.offset ?? 0
  const baseDuration = target.duration
  frozenSpan.value = span.value
  dragging.value = true
  handle.setPointerCapture(event.pointerId)

  const onMove = (e: PointerEvent) => {
    const delta = Math.round(((e.clientX - startX) * msPerPx) / 10) * 10
    if (mode === 'move') {
      const next = stepIndex === 0 ? Math.max(0, baseOffset + delta) : baseOffset + delta
      target.offset = next === 0 ? undefined : next
    } else {
      target.duration = Math.max(10, baseDuration + delta)
    }
  }
  const onUp = () => {
    handle.releasePointerCapture(event.pointerId)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
    dragging.value = false
    frozenSpan.value = null
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
}

function addStep() {
  const steps = animation.value?.steps
  if (!steps) return
  steps.push({
    id: uid(),
    tracks: [{ prop: 'opacity', from: 0, to: 1 }],
    duration: 400,
    easing: 'ease-out',
  })
  selectedStep.value = steps.length - 1
}
function duplicateStep(index: number) {
  const steps = animation.value?.steps
  const item = steps?.[index]
  if (!steps || !item) return
  steps.splice(index + 1, 0, { ...structuredClone(item), id: uid() })
  selectedStep.value = index + 1
}
function removeStep(index: number) {
  const steps = animation.value?.steps
  if (steps && steps.length > 1) steps.splice(index, 1)
}
function openTrackSettings(event: MouseEvent, row: TrackRow) {
  selectedStep.value = row.stepIndex
  openPopover({
    id: `motion-track-${row.step.id}-${row.trackIndex}`,
    component: TrackSettingsPopover,
    props: { step: row.step, index: row.trackIndex },
    anchor: (event.currentTarget as HTMLElement).closest('[data-track-row]') as HTMLElement,
    placement: 'bottom-start',
    closeOnOutside: true,
    width: 'w-64',
    header: false,
    scroll: false,
    title: () => MOTION_PROPS[row.track.prop].label,
  })
}

function setNum<T, K extends keyof T>(obj: T, key: K, text: string, fallback = 0) {
  const n = parseFloat(text)
  obj[key] = (text.trim() === '' ? fallback : isFinite(n) ? n : fallback) as T[K]
}
</script>

<template>
  <div v-if="animation" class="flex flex-col">
    <div class="relative flex flex-col">
    <header class="h-9 shrink-0 px-2" :class="ROW_GRID">
      <p class="section-label">Motion</p>
      <div class="relative h-3">
        <span
          v-for="t in ticks"
          :key="t"
          class="absolute top-0 text-[9px] text-muted-foreground tabular-nums"
          :class="pct(t) >= 99 && '-translate-x-full'"
          :style="{ left: `${pct(t)}%` }"
        >
          {{ t }}
        </span>
      </div>
    </header>

    <div class="flex flex-col gap-1 border-b border-input px-2 pb-2">
      <template v-for="group in groups" :key="group.step.id">
        <div :class="ROW_GRID">
          <div
            class="group/step flex h-7 items-center gap-1 px-1"
            @click="selectedStep = group.index"
          >
            <button
              type="button"
              class="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground"
              :aria-label="group.open ? 'Collapse step' : 'Expand step'"
              :aria-expanded="group.open"
              @click.stop="toggleStep(group.step.id)"
            >
              <ChevronRight class="size-3 transition-transform" :class="group.open && 'rotate-90'" />
            </button>
            <span
              class="min-w-0 flex-1 truncate section-label"
              :class="group.index === selectedStep && 'text-foreground'"
            >
              Step {{ group.index + 1 }}
            </span>
            <span class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/step:opacity-100">
              <button
                v-if="animation.steps.length > 1"
                v-tooltip="{ text: 'Delete step', side: 'left' }"
                type="button"
                class="flex size-4 items-center justify-center rounded text-muted-foreground outline-none hover:text-danger"
                @click.stop="removeStep(group.index)"
              >
                <Trash2 class="size-3" />
              </button>
              <button
                v-tooltip="{ text: 'Duplicate step', side: 'left' }"
                type="button"
                class="flex size-4 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground"
                @click.stop="duplicateStep(group.index)"
              >
                <Copy class="size-3" />
              </button>
            </span>
          </div>
          <div data-track-area class="relative flex h-7 min-w-0 items-center" :style="gridStyle">
            <div
              v-if="group.bar"
              class="absolute inset-y-1.5 flex items-center rounded-md border transition-colors"
              :class="
                group.index === selectedStep
                  ? 'border-accent bg-accent/40'
                  : 'border-input bg-secondary hover:border-accent'
              "
              :style="{
                left: `${pct(group.bar.start)}%`,
                width: `${Math.max(pct(group.bar.duration), 2)}%`,
              }"
              :title="`Step ${group.index + 1} · ${group.bar.duration}ms · ${group.bar.easing}`"
              @pointerdown="onBarDown($event, group.index, 'move')"
            >
              <span v-if="group.bar.stagger" class="truncate px-1 text-[9px] text-muted-foreground">
                +{{ group.bar.stagger }}
              </span>
              <span
                class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md bg-accent-foreground/30 hover:bg-accent-foreground/60"
                @pointerdown.stop="onBarDown($event, group.index, 'resize')"
              />
            </div>
          </div>
        </div>

        <div
          v-for="row in group.open ? group.rows : []"
          :key="row.key"
          data-track-row
          :class="ROW_GRID"
        >
          <div
            class="group/track ml-3 flex h-7 items-center gap-1 rounded-lg px-2 text-xs"
            :class="
              row.stepIndex === selectedStep
                ? 'bg-accent/30 text-foreground'
                : 'text-muted-foreground hover:bg-accent/15'
            "
          >
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
              @click="openTrackSettings($event, row)"
            >
              {{ MOTION_PROPS[row.track.prop].label }}
              <span class="ml-1 text-[10px] opacity-50">{{ trackSummary(row.track) }}</span>
            </button>

            <span class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/track:opacity-100">
              <button
                v-tooltip="{ text: 'Remove property', side: 'left' }"
                type="button"
                class="flex size-4 items-center justify-center rounded outline-none hover:text-danger"
                @click.stop="removeTrack(row.step, row.trackIndex)"
              >
                <Trash2 class="size-3" />
              </button>
              <button
                v-tooltip="{ text: 'Duplicate property', side: 'left' }"
                type="button"
                class="flex size-4 items-center justify-center rounded outline-none hover:text-foreground"
                @click.stop="duplicateTrack(row.step, row.trackIndex)"
              >
                <Copy class="size-3" />
              </button>
              <button
                v-tooltip="{ text: 'Property settings', side: 'left' }"
                type="button"
                class="flex size-4 items-center justify-center rounded outline-none hover:text-foreground"
                @click.stop="openTrackSettings($event, row)"
              >
                <Settings2 class="size-3" />
              </button>
            </span>
          </div>

          <div class="relative h-5 min-w-0" :style="gridStyle">
            <div
              class="absolute inset-y-2 rounded-full"
              :class="row.stepIndex === selectedStep ? 'bg-accent/60' : 'bg-input'"
              :style="{ left: `${pct(row.start)}%`, width: `${Math.max(pct(row.duration), 2)}%` }"
            />
          </div>
        </div>

        <ButtonUI
          v-if="group.open"
          variant="ghost"
          size="xs"
          :icon="Plus"
          class="ml-3 w-fit text-muted-foreground"
          @click="(selectedStep = group.index), addTrack(group.step)"
        >
          Property
        </ButtonUI>
      </template>

      <ButtonUI
        variant="ghost"
        size="xs"
        :icon="Plus"
        class="mt-1 w-fit text-muted-foreground"
        @click="addStep"
      >
        Step
      </ButtonUI>
    </div>

    <div
      class="pointer-events-none absolute top-5 bottom-1 w-px bg-accent-foreground"
      :style="{ left: headLeft }"
    >
      <span class="absolute -top-1 -left-[3px] size-[7px] rounded-full bg-accent-foreground" />
    </div>
    </div>

    <div v-if="step" class="grid grid-cols-5 gap-x-2 gap-y-1.5 p-2">
      <label class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[10px] text-muted-foreground">Duration</span>
        <ValueFieldUI
          unit="ms"
          :model-value="String(step.duration)"
          @commit="(t) => setNum(step!, 'duration', t, 400)"
        />
      </label>

      <label class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[10px] text-muted-foreground">Easing</span>
        <SelectUI
          :options="EASING_OPTIONS"
          :model-value="step.easing"
          @update:model-value="(v) => v && (step!.easing = v)"
        />
      </label>

      <label class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[10px] text-muted-foreground">
          {{ selectedStep > 0 ? 'Offset' : 'Delay' }}
        </span>
        <ValueFieldUI
          v-tooltip="selectedStep > 0 ? 'Negative overlaps the step before' : 'Before this step runs'"
          unit="ms"
          :model-value="String(step.offset ?? 0)"
          :allow-negative="selectedStep > 0"
          @commit="
            (t) => (t.trim() === '' || t === '0' ? (step!.offset = undefined) : setNum(step!, 'offset', t))
          "
        />
      </label>

      <label class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[10px] text-muted-foreground">Stagger</span>
        <ValueFieldUI
          v-tooltip="'Per child'"
          unit="ms"
          :model-value="String(step.stagger ?? 0)"
          @commit="
            (t) => (t.trim() === '' || t === '0' ? (step!.stagger = undefined) : setNum(step!, 'stagger', t))
          "
        />
      </label>

      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[10px] text-muted-foreground">Repeat</span>
        <div class="flex min-w-0 items-center gap-1">
          <ValueFieldUI
            v-tooltip="'Extra plays after the first — −1 repeats forever'"
            full
            :model-value="String(step.repeat ?? 0)"
            allow-negative
            @commit="
              (t) => (t.trim() === '' || t === '0' ? (step!.repeat = undefined) : setNum(step!, 'repeat', t))
            "
          />
          <ButtonUI
            :variant="step.yoyo ? 'outline' : 'ghost'"
            size="xs"
            class="shrink-0"
            :class="step.yoyo ? '' : 'text-muted-foreground opacity-60'"
            tooltip="Play each repeat back and forth"
            :aria-pressed="!!step.yoyo"
            @click="step!.yoyo = step!.yoyo ? undefined : true"
          >
            Yoyo
          </ButtonUI>
        </div>
      </div>

      <label v-if="step.stagger" class="col-span-2 flex min-w-0 flex-col gap-0.5">
        <span class="text-[10px] text-muted-foreground">Cascade</span>
        <InputUI
          :model-value="step.staggerSelector ?? ''"
          placeholder="direct children"
          class="font-mono"
          @update:model-value="(v) => (step!.staggerSelector = v.trim() || undefined)"
        />
      </label>

      <p v-if="step.stagger" class="col-span-5 text-[10px] text-muted-foreground">
        Staggered properties move the children; the step's other properties still move this element.
      </p>
    </div>

    <p v-if="animationError(animation)" class="px-2.5 pb-2 text-[10px] text-danger">
      {{ animationError(animation) }}
    </p>
  </div>
</template>
