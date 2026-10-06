<script setup lang="ts">
// What a MOTION effect does, on a time ruler.
//
// The same steps and tracks the vertical form held, drawn against time: one bar
// per property, positioned by where it actually starts and how long it runs.
// The numbers were all there before — `offset`, `duration`, `stagger` — but
// nothing showed that step 2 overlapped step 1, so timing was authored by
// arithmetic. Drag a bar to move it, drag its edge to stretch it, click it to
// edit the step it belongs to.
//
// The geometry is NOT a second source of truth: it is `compileAnimation`, the
// same compiler the canvas, the exporter and the published runtime use, so what
// the ruler shows is what plays. A drag writes back to the step's own fields.
//
// Takes an ID and re-resolves, never an object: undo and a branch switch swap
// the whole project graph, so a held object would detach silently.
import { computed, ref, watch } from 'vue'
import { Copy, Plus, Trash2, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import ColorFieldUI from '@/components/editor/style/ColorFieldUI.vue'
import { useAnimation } from '@/composables/useAnimation'
import { useSettings } from '@/composables/useSettings'
import { compileAnimation, EASING_NAMES, MOTION_PROPS } from '@/lib/motion'
import type { AnimProp, AnimationStep, AnimationTrack } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

const props = defineProps<{ id: string }>()

const { animationFor, animationError } = useAnimation()
const { validTokens } = useSettings()

const animation = computed(() => animationFor(props.id))

const EASING_OPTIONS = EASING_NAMES.map((e) => ({ label: e, value: e }))
const PROP_OPTIONS = (Object.keys(MOTION_PROPS) as AnimProp[]).map((p) => ({
  label: MOTION_PROPS[p].label,
  value: p,
}))
const colorTokens = computed(() => validTokens.value.map((t) => ({ name: t.name, value: t.value })))
const isColor = (prop: AnimProp) => MOTION_PROPS[prop].kind === 'color'
/** `count` is the one track that writes TEXT, so it carries its own formatting
 *  — the authored text IS the final value, and this has to read the same way */
const isCount = (prop: AnimProp) => MOTION_PROPS[prop].kind === 'text'
const formatOf = (track: AnimationTrack) => (track.format ??= {})
function setFormat<K extends keyof NonNullable<AnimationTrack['format']>>(
  track: AnimationTrack,
  key: K,
  value: NonNullable<AnimationTrack['format']>[K],
) {
  const f = formatOf(track)
  if (value === undefined || value === '' || value === false) delete f[key]
  else f[key] = value
  // an empty format is no format at all, so an untouched track stays
  // byte-identical for the merge signature
  if (!Object.keys(f).length) delete track.format
}

// --- the ruler ---

const compiled = computed(() => (animation.value ? compileAnimation(animation.value) : null))

/** a short timeline must not fill the width, or 100ms and 1000ms look alike */
const liveSpan = computed(() => Math.max(compiled.value?.duration ?? 0, 400))
/**
 * The scale is FROZEN while dragging. Stretching a bar changes the timeline
 * length, which would rescale the ruler under the pointer — the bar would then
 * chase the cursor instead of following it.
 */
const frozenSpan = ref<number | null>(null)
const span = computed(() => frozenSpan.value ?? liveSpan.value)

const pct = (ms: number) => (span.value <= 0 ? 0 : (ms / span.value) * 100)

const TICK_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 5000]
const tickStep = computed(() => TICK_STEPS.find((s) => span.value / s <= 8) ?? 10000)
const ticks = computed(() => {
  const out: number[] = []
  for (let t = 0; t <= span.value; t += tickStep.value) out.push(t)
  return out
})

// --- which step the form edits ---

const selectedStep = ref(0)
watch(
  () => props.id,
  () => (selectedStep.value = 0),
)
// a deleted step must not leave the form pointing past the end
watch(
  () => animation.value?.steps.length ?? 0,
  (n) => {
    if (selectedStep.value >= n) selectedStep.value = Math.max(0, n - 1)
  },
)

const step = computed<AnimationStep | null>(() => animation.value?.steps[selectedStep.value] ?? null)

// --- dragging a bar ---

const dragging = ref(false)

/**
 * `move` writes the step's `offset` (ms from the previous step's END, which for
 * step 0 IS the delay, so it cannot go negative); `resize` writes its
 * `duration`. Both snap to 10ms, and both store 0 as `undefined` so an
 * untouched step stays byte-identical for the merge signature.
 */
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

// --- steps and tracks ---

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
function addTrack(target: AnimationStep) {
  const used = new Set(target.tracks.map((t) => t.prop))
  const next = (Object.keys(MOTION_PROPS) as AnimProp[]).find((p) => !used.has(p)) ?? 'opacity'
  target.tracks.push({
    prop: next,
    from: isColor(next) ? '#000000' : 0,
    to: isColor(next) ? '#ffffff' : 1,
  })
}
function removeTrack(target: AnimationStep, index: number) {
  target.tracks.splice(index, 1) // an empty step is caught by validation
}
/** switching property resets the values to that property's sensible pair */
function setTrackProp(target: AnimationStep, index: number, prop: AnimProp) {
  const track = target.tracks[index]
  if (!track) return
  track.prop = prop
  if (isColor(prop)) {
    track.from = '#000000'
    track.to = '#ffffff'
  } else {
    track.from = MOTION_PROPS[prop].def as number
    track.to = prop === 'opacity' || prop === 'scale' ? 1 : 100
  }
  if (!isCount(prop)) delete track.format
}

const numText = (v: number | string | undefined) => (v === undefined ? '' : String(v))

// track values may carry a unit — '110%', '1em', '50vw' — so a move can be
// relative to the element or the viewport instead of a px measured at one size
const TRACK_VALUE_RE = /^-?\d+(\.\d+)?(px|%|em|rem|vw|vh|deg)?$/
const isTrackValue = (text: string) => text.trim() === '' || TRACK_VALUE_RE.test(text.trim())
/** a bare number stays a number (the property's own unit); a united value
 * stays a string so the unit survives into the CSS */
function trackValue(text: string): number | string {
  const t = text.trim()
  const n = parseFloat(t)
  return /^-?\d+(\.\d+)?$/.test(t) ? (isFinite(n) ? n : 0) : t
}
function setNum<T, K extends keyof T>(obj: T, key: K, text: string, fallback = 0) {
  const n = parseFloat(text)
  obj[key] = (text.trim() === '' ? fallback : isFinite(n) ? n : fallback) as T[K]
}
</script>

<template>
  <div v-if="animation" class="flex flex-col">
    <!-- the ruler: every property's journey, where it really happens -->
    <div class="flex flex-col gap-1 border-b border-input p-2">
      <div class="flex items-center gap-2">
        <!-- the unit lives in the label gutter, never over the ruler: the last
             tick sits at the right edge and the two would collide there -->
        <span class="w-20 shrink-0 text-right text-[9px] text-muted-foreground">ms</span>
        <div class="relative h-3 flex-1">
          <!-- the last tick sits AT the right edge, so it is drawn leftwards:
               hanging past the ruler, it was what gave the drawer a horizontal
               scrollbar -->
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
      </div>

      <div
        v-for="(track, i) in compiled?.tracks ?? []"
        :key="`${track.stepIndex}-${track.prop}-${i}`"
        class="flex items-center gap-2"
      >
        <span class="w-20 shrink-0 truncate text-[10px] text-muted-foreground">
          {{ MOTION_PROPS[track.prop].label }}
        </span>
        <div data-track-area class="relative h-5 flex-1 rounded-md bg-muted/40">
          <div
            class="absolute inset-y-0.5 flex items-center rounded-md border transition-colors"
            :class="
              track.stepIndex === selectedStep
                ? 'border-accent bg-accent/40'
                : 'border-input bg-secondary hover:border-accent'
            "
            :style="{ left: `${pct(track.start)}%`, width: `${Math.max(pct(track.duration), 2)}%` }"
            :title="`Step ${track.stepIndex + 1} · ${track.duration}ms · ${track.easing}`"
            @pointerdown="onBarDown($event, track.stepIndex, 'move')"
          >
            <span v-if="track.stagger" class="truncate px-1 text-[9px] text-muted-foreground">
              +{{ track.stagger }}
            </span>
            <!-- the right edge stretches the step -->
            <span
              class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md bg-accent-foreground/30 hover:bg-accent-foreground/60"
              @pointerdown.stop="onBarDown($event, track.stepIndex, 'resize')"
            />
          </div>
        </div>
      </div>

      <p v-if="!(compiled?.tracks ?? []).length" class="px-1 text-[10px] text-muted-foreground">
        No properties yet — add one below.
      </p>
    </div>

    <!-- which step the form below edits -->
    <div class="flex flex-wrap items-center gap-1 border-b border-input px-2 py-1.5">
      <ButtonUI
        v-for="(s, si) in animation.steps"
        :key="s.id"
        size="xs"
        :variant="si === selectedStep ? 'outline' : 'ghost'"
        :class="si === selectedStep ? '' : 'text-muted-foreground'"
        @click="selectedStep = si"
      >
        Step {{ si + 1 }}
      </ButtonUI>
      <ButtonUI
        variant="ghost"
        size="xs"
        :icon="Plus"
        class="text-muted-foreground"
        @click="addStep"
      >
        Step
      </ButtonUI>
      <div class="ml-auto flex items-center gap-1">
        <ButtonUI
          variant="icon"
          size="xs"
          :icon="Copy"
          tooltip="Duplicate step"
          class="w-5 text-muted-foreground"
          @click="duplicateStep(selectedStep)"
        />
        <ButtonUI
          v-if="animation.steps.length > 1"
          variant="icon"
          size="xs"
          :icon="Trash2"
          tooltip="Delete step"
          class="w-5 text-muted-foreground hover:!text-danger"
          @click="removeStep(selectedStep)"
        />
      </div>
    </div>

    <!-- the selected step, in full -->
    <div v-if="step" class="grid grid-cols-1 gap-x-4 gap-y-1 p-2 xl:grid-cols-2">
      <div class="flex flex-col gap-1">
        <!-- keyed by index AND prop: a track has no id, and a bare index makes
             the value fields keep their draft text when one is removed -->
        <div
          v-for="(track, ti) in step.tracks"
          :key="`${ti}-${track.prop}`"
          class="flex items-center gap-1"
        >
          <div class="min-w-0 flex-1">
            <SelectUI
              :options="PROP_OPTIONS"
              :model-value="track.prop"
              @update:model-value="(v) => v && setTrackProp(step!, ti, v as AnimProp)"
            />
          </div>
          <template v-if="isColor(track.prop)">
            <ColorFieldUI
              :model-value="String(track.from ?? '')"
              :tokens="colorTokens"
              :swatch="String(track.from ?? '#000000')"
              placeholder="from"
              @commit="(t) => (track.from = t)"
              @pick="(v) => (track.from = v)"
            />
            <span class="shrink-0 text-[10px] text-muted-foreground">→</span>
            <ColorFieldUI
              :model-value="String(track.to ?? '')"
              :tokens="colorTokens"
              :swatch="String(track.to ?? '#ffffff')"
              placeholder="to"
              @commit="(t) => (track.to = t)"
              @pick="(v) => (track.to = v)"
            />
          </template>
          <template v-else>
            <ValueFieldUI
              v-tooltip="'From (empty = current value)'"
              :model-value="numText(track.from)"
              placeholder="auto"
              allow-negative
              :validate="isTrackValue"
              @commit="(t) => (t.trim() === '' ? (track.from = undefined) : (track.from = trackValue(t)))"
            />
            <span class="shrink-0 text-[10px] text-muted-foreground">→</span>
            <ValueFieldUI
              v-tooltip="'To'"
              :model-value="numText(track.to)"
              allow-negative
              :validate="isTrackValue"
              @commit="(t) => (track.to = trackValue(t))"
            />
          </template>
          <ButtonUI
            variant="icon"
            size="xs"
            :icon="X"
            tooltip="Remove property"
            class="w-5 shrink-0 text-muted-foreground"
            @click="removeTrack(step!, ti)"
          />
        </div>
        <!-- how the number reads. It has to agree with the element's authored
             text, which IS the final value — `18,000+` is group + suffix. -->
        <div
          v-for="(track, ti) in step.tracks.filter((t) => isCount(t.prop))"
          :key="`fmt-${ti}`"
          class="flex items-center gap-1 pl-2"
        >
          <span class="shrink-0 text-[10px] text-muted-foreground">Reads</span>
          <ValueFieldUI
            v-tooltip="'Prefix'"
            :model-value="track.format?.prefix ?? ''"
            placeholder="$"
            @commit="(t) => setFormat(track, 'prefix', t)"
          />
          <ValueFieldUI
            v-tooltip="'Decimal places'"
            :model-value="track.format?.decimals === undefined ? '' : String(track.format.decimals)"
            placeholder="0"
            :validate="(t: string) => t.trim() === '' || /^\d{1,2}$/.test(t.trim())"
            @commit="(t) => setFormat(track, 'decimals', t.trim() === '' ? undefined : Number(t))"
          />
          <ValueFieldUI
            v-tooltip="'Suffix'"
            :model-value="track.format?.suffix ?? ''"
            placeholder="+"
            @commit="(t) => setFormat(track, 'suffix', t)"
          />
          <ButtonUI
            variant="outline"
            size="xs"
            tooltip="Thousands separators"
            class="shrink-0"
            :class="track.format?.group && 'bg-accent text-accent-foreground'"
            @click="setFormat(track, 'group', !track.format?.group)"
          >
            1,000
          </ButtonUI>
        </div>
        <ButtonUI
          variant="ghost"
          size="xs"
          :icon="Plus"
          class="justify-start text-muted-foreground"
          @click="addTrack(step!)"
        >
          Property
        </ButtonUI>
      </div>

      <div class="flex flex-col gap-1">
        <RowUI label="Duration">
          <ValueFieldUI
            :model-value="String(step.duration)"
            @commit="(t) => setNum(step!, 'duration', t, 400)"
          />
          <span class="text-[10px] text-muted-foreground">ms</span>
        </RowUI>
        <RowUI label="Easing">
          <SelectUI
            :options="EASING_OPTIONS"
            :model-value="step.easing"
            @update:model-value="(v) => v && (step!.easing = v)"
          />
        </RowUI>
        <RowUI v-if="selectedStep > 0" label="Offset">
          <ValueFieldUI
            :model-value="String(step.offset ?? 0)"
            allow-negative
            @commit="(t) => (t.trim() === '' || t === '0' ? (step!.offset = undefined) : setNum(step!, 'offset', t))"
          />
          <span class="text-[10px] text-muted-foreground">ms · negative overlaps</span>
        </RowUI>
        <RowUI v-else label="Delay">
          <ValueFieldUI
            :model-value="String(step.offset ?? 0)"
            @commit="(t) => (t.trim() === '' || t === '0' ? (step!.offset = undefined) : setNum(step!, 'offset', t))"
          />
          <span class="text-[10px] text-muted-foreground">ms</span>
        </RowUI>
        <RowUI label="Stagger">
          <ValueFieldUI
            :model-value="String(step.stagger ?? 0)"
            @commit="(t) => (t.trim() === '' || t === '0' ? (step!.stagger = undefined) : setNum(step!, 'stagger', t))"
          />
          <span class="text-[10px] text-muted-foreground">ms per child</span>
        </RowUI>
        <RowUI v-if="step.stagger" label="Cascade">
          <InputUI
            :model-value="step.staggerSelector ?? ''"
            placeholder="direct children"
            class="font-mono"
            @update:model-value="(v) => (step!.staggerSelector = v.trim() || undefined)"
          />
        </RowUI>
        <p v-if="step.stagger" class="px-2.5 text-[10px] text-muted-foreground">
          Staggered properties move the children; the step's other properties still
          move this element.
        </p>
        <RowUI label="Repeat">
          <ValueFieldUI
            v-tooltip="'Extra plays after the first — −1 repeats forever'"
            :model-value="String(step.repeat ?? 0)"
            allow-negative
            @commit="(t) => (t.trim() === '' || t === '0' ? (step!.repeat = undefined) : setNum(step!, 'repeat', t))"
          />
          <span class="text-[10px] text-muted-foreground">−1 = forever</span>
          <ButtonUI
            :variant="step.yoyo ? 'outline' : 'ghost'"
            size="xs"
            class="ml-auto"
            :class="step.yoyo ? '' : 'text-muted-foreground opacity-60'"
            tooltip="Play each repeat back and forth"
            @click="step!.yoyo = step!.yoyo ? undefined : true"
          >
            Yoyo
          </ButtonUI>
        </RowUI>
      </div>
    </div>

    <p v-if="animationError(animation)" class="px-2.5 pb-2 text-[10px] text-danger">
      {{ animationError(animation) }}
    </p>
  </div>
</template>
