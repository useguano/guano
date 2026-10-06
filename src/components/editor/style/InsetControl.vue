<script setup lang="ts">
import { ref } from 'vue'
import StepperUI from '@/components/ui/StepperUI.vue'
import { SPACING } from '@/lib/tieredBox'
import { parseTail, buildTailClass } from '@/lib/valueClass'
import { Lock, LockOpen } from 'lucide-vue-next'

// Cross-shaped inset editor: top / left · right / bottom steppers laid out in a
// plus, with a centre lock that syncs all four sides to one value.
//
//         [-] 12 [+]
//  [-] 12 [+] 🔒 [-] 12 [+]
//         [-] 12 [+]

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const SIDES = ['top', 'right', 'bottom', 'left'] as const
type Side = (typeof SIDES)[number]

const STEPS = SPACING
const KEYWORDS = ['auto'] as const

// the current value tail for a side (e.g. '4', '[4em]', '-4', 'auto'), or null
function tailOf(side: Side): string | null {
  for (const c of props.modelValue) {
    const tail = parseTail(c, side, { allowKeywords: KEYWORDS })
    if (tail !== null) return tail
  }
  return null
}

// side tokens include the negative form (-top-4); clear both spellings
function stripSide(list: string[], side: Side): string[] {
  return list.filter((c) => parseTail(c, side, { allowKeywords: KEYWORDS }) === null)
}

// lock on by default when all four already share one value
const locked = ref(
  SIDES.every((s) => tailOf(s) !== null) && new Set(SIDES.map(tailOf)).size === 1,
)

function apply(sides: readonly Side[], tail: string | null) {
  let next = props.modelValue
  for (const s of sides) next = stripSide(next, s)
  if (tail !== null) for (const s of sides) next = [...next, buildTailClass(s, tail)]
  emit('update:modelValue', next)
}

function setSide(side: Side, tail: string | null) {
  apply(locked.value ? SIDES : [side], tail)
}

function toggleLock() {
  locked.value = !locked.value
  if (!locked.value) return
  // equalise to the first side that has a value
  const first = SIDES.map(tailOf).find((v) => v !== null) ?? null
  if (first !== null) apply(SIDES, first)
}
</script>

<template>
  <div class="flex flex-col items-center gap-1.5 px-2.5 py-2">
    <div class="w-28">
      <StepperUI :steps="STEPS" allow-custom allow-negative :allow-keywords="KEYWORDS" :model-value="tailOf('top')" @update:model-value="(v) => setSide('top', v)" />
    </div>

    <div class="flex items-center gap-1.5">
      <div class="w-24">
        <StepperUI :steps="STEPS" allow-custom allow-negative :allow-keywords="KEYWORDS" :model-value="tailOf('left')" @update:model-value="(v) => setSide('left', v)" />
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
        <StepperUI :steps="STEPS" allow-custom allow-negative :allow-keywords="KEYWORDS" :model-value="tailOf('right')" @update:model-value="(v) => setSide('right', v)" />
      </div>
    </div>

    <div class="w-28">
      <StepperUI :steps="STEPS" allow-custom allow-negative :allow-keywords="KEYWORDS" :model-value="tailOf('bottom')" @update:model-value="(v) => setSide('bottom', v)" />
    </div>
  </div>
</template>
