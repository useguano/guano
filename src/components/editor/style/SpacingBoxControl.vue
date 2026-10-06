<script setup lang="ts">
import { ref, computed } from 'vue'
import StepperUI from '@/components/ui/StepperUI.vue'
import {
  spacingScheme,
  effectiveSides,
  setStep,
  migrateTier,
  inferTier,
  type Scheme,
  type Slot,
} from '@/lib/tieredBox'
import { Lock, LockOpen, RotateCcw } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'

// Padding / margin / border-width as a cross of four side steppers (top / left ·
// lock · right / bottom) with a centre lock. Locked = one value drives all sides
// (the `p-4` shorthand, i.e. the old "All" tier); unlocked = independent per-side
// (`pt-4`…, the "Sides" tier). Existing p-/px-/py- shorthands resolve for display.

const props = defineProps<{
  label: string
  base: string
  modelValue: string[]
  allowNegative?: boolean
  /** keywords the side fields accept verbatim (e.g. `auto` for margins) */
  allowKeywords?: readonly string[]
  /** the class scheme (spacing by default; border-width for the Border section) */
  scheme?: Scheme
  /** classes at selection time — the revert button restores this base to it */
  baseline?: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const scheme = props.scheme ?? spacingScheme
const STEPS = scheme.steps
const SLOTS: Slot[] = ['all', 'x', 'y', 't', 'r', 'b', 'l']

const sides = computed(() => effectiveSides(scheme, props.modelValue, props.base))

// start locked when the value is a single "all" (or nothing) rather than per-side
const locked = ref(inferTier(scheme, props.modelValue, props.base) === 'all')

const slot = (s: Slot) => scheme.slot(props.base, s)

function setAll(tail: string | null) {
  let next = migrateTier(scheme, props.modelValue, props.base, 'all')
  next = setStep(scheme, next, slot('all'), tail)
  emit('update:modelValue', next)
}
function setSideSlot(s: 't' | 'r' | 'b' | 'l', tail: string | null) {
  let next = props.modelValue
  // expand any p-/px- shorthand into per-side classes before editing one side
  if (inferTier(scheme, next, props.base) !== 'sides') {
    next = migrateTier(scheme, next, props.base, 'sides')
  }
  next = setStep(scheme, next, slot(s), tail)
  emit('update:modelValue', next)
}
function setSide(s: 't' | 'r' | 'b' | 'l', tail: string | null) {
  if (locked.value) setAll(tail)
  else setSideSlot(s, tail)
}

function toggleLock() {
  locked.value = !locked.value
  emit('update:modelValue', migrateTier(scheme, props.modelValue, props.base, locked.value ? 'all' : 'sides'))
}

// --- revert to selection-time baseline ---

// the tokens belonging to this base (all its slots), for dirty-check / revert
function baseTokens(list: string[]): string[] {
  return list.filter((c) => SLOTS.some((s) => scheme.parse(c, slot(s)) !== null))
}
const dirty = computed(
  () => baseTokens(props.modelValue).sort().join(' ') !== baseTokens(props.baseline ?? []).sort().join(' '),
)
function revert() {
  const keep = props.modelValue.filter((c) => !SLOTS.some((s) => scheme.parse(c, slot(s)) !== null))
  emit('update:modelValue', [...keep, ...baseTokens(props.baseline ?? [])])
}
</script>

<template>
  <!-- px-2.5 pl-8 mirrors RowUI so the label + revert gutter line up with other rows -->
  <div class="relative flex flex-col gap-1.5 px-2.5 pl-8">
    <div class="absolute left-1 top-0">
      <ButtonUI
        v-if="dirty"
        variant="ghost"
        size="xs"
        :icon="RotateCcw"
        tooltip="Revert"
        class="aspect-square shrink-0 text-muted-foreground"
        @click="revert"
      />
    </div>
    <span class="text-xs leading-6 text-foreground">{{ label }}</span>

    <div class="flex flex-col items-center gap-1.5 py-1">
      <div class="w-28">
        <StepperUI :steps="STEPS" allow-custom :allow-negative="allowNegative" :allow-keywords="allowKeywords" :model-value="sides.t" @update:model-value="(v) => setSide('t', v)" />
      </div>

      <div class="flex items-center gap-1.5">
        <div class="w-24">
          <StepperUI :steps="STEPS" allow-custom :allow-negative="allowNegative" :allow-keywords="allowKeywords" :model-value="sides.l" @update:model-value="(v) => setSide('l', v)" />
        </div>

        <button
          v-tooltip="locked ? 'Unlock sides' : 'Lock all sides'"
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors"
          :class="
            locked
              ? 'border-accent bg-accent/30 text-accent-foreground'
              : 'border-input text-muted-foreground hover:text-foreground'
          "
          @click="toggleLock"
        >
          <component :is="locked ? Lock : LockOpen" class="size-3.5" />
        </button>

        <div class="w-24">
          <StepperUI :steps="STEPS" allow-custom :allow-negative="allowNegative" :allow-keywords="allowKeywords" :model-value="sides.r" @update:model-value="(v) => setSide('r', v)" />
        </div>
      </div>

      <div class="w-28">
        <StepperUI :steps="STEPS" allow-custom :allow-negative="allowNegative" :allow-keywords="allowKeywords" :model-value="sides.b" @update:model-value="(v) => setSide('b', v)" />
      </div>
    </div>
  </div>
</template>
