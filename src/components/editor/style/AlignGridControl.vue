<script setup lang="ts">
import { computed } from 'vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { RotateCcw } from 'lucide-vue-next'

// A Figma-style 9-dot alignment picker. One click writes both axis classes
// (e.g. items-center + justify-center); clicking the active dot clears them.
// Values a dot can't express (between/around/evenly, stretch/baseline) live
// in the two escape-hatch selects below the grid.

const props = withDefaults(
  defineProps<{
    /** the element's class tokens — the single source of truth */
    modelValue: string[]
    /** container writes items-* + justify-*; self writes self-* + justify-self-* */
    mode?: 'container' | 'self'
    /** main axis runs vertically (flex-col) — swaps which family each grid axis writes */
    vertical?: boolean
    /** the element's classes at selection time — revert hides when back to this */
    baseline?: string[]
  }>(),
  { mode: 'container' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const POS = ['start', 'center', 'end'] as const

const families = computed(() =>
  props.mode === 'container'
    ? {
        main: POS.map((p) => `justify-${p}`),
        mainExtra: ['justify-between', 'justify-around', 'justify-evenly'],
        cross: POS.map((p) => `items-${p}`),
        crossExtra: ['items-stretch', 'items-baseline'],
      }
    : {
        main: POS.map((p) => `justify-self-${p}`),
        mainExtra: [] as string[],
        cross: POS.map((p) => `self-${p}`),
        crossExtra: ['self-stretch'],
      },
)

const mainIndex = computed(() => families.value.main.findIndex((c) => props.modelValue.includes(c)))
const crossIndex = computed(() => families.value.cross.findIndex((c) => props.modelValue.includes(c)))

// visual x/y → main/cross class family (flex-col swaps the axes)
const swapAxes = computed(() => props.mode === 'container' && props.vertical)

function axesFor(x: number, y: number) {
  return swapAxes.value ? { m: y, c: x } : { m: x, c: y }
}

function cellState(x: number, y: number): 'on' | 'half' | 'off' {
  const { m, c } = axesFor(x, y)
  const mainOn = mainIndex.value === m
  const crossOn = crossIndex.value === c
  if (mainOn && crossOn) return 'on'
  // one axis set, the other free (e.g. justify-between active) — hint the line
  if ((mainOn && crossIndex.value === -1) || (crossOn && mainIndex.value === -1)) return 'half'
  return 'off'
}

function strip(list: string[], remove: string[]): string[] {
  return list.filter((cls) => !remove.includes(cls))
}

// every class this widget manages, for the revert button
const managed = computed(() => {
  const f = families.value
  return [...f.main, ...f.mainExtra, ...f.cross, ...f.crossExtra]
})

function managedOf(list: string[]): string {
  return list
    .filter((c) => managed.value.includes(c))
    .sort()
    .join(' ')
}

// dirty only when the managed classes differ from the selection-time baseline
const hasValue = computed(() => managedOf(props.modelValue) !== managedOf(props.baseline ?? []))

function revert() {
  const restore = (props.baseline ?? []).filter((c) => managed.value.includes(c))
  emit('update:modelValue', [...strip(props.modelValue, managed.value), ...restore])
}

function pick(x: number, y: number) {
  const f = families.value
  const { m, c } = axesFor(x, y)
  const clearing = mainIndex.value === m && crossIndex.value === c
  let next = strip(props.modelValue, [...f.main, ...f.mainExtra, ...f.cross, ...f.crossExtra])
  if (!clearing) next = [...next, f.main[m]!, f.cross[c]!]
  emit('update:modelValue', next)
}

function cellTitle(x: number, y: number): string {
  const f = families.value
  const { m, c } = axesFor(x, y)
  return `${f.cross[c]} ${f.main[m]}`
}

// --- escape-hatch selects ---

const spacing = computed(
  () => props.modelValue.find((cls) => families.value.mainExtra.includes(cls)) ?? '',
)
const stretch = computed(
  () => props.modelValue.find((cls) => families.value.crossExtra.includes(cls)) ?? '',
)

function setSpacing(cls: string) {
  const f = families.value
  let next = strip(props.modelValue, [...f.main, ...f.mainExtra])
  if (cls && cls !== NONE) next = [...next, cls]
  emit('update:modelValue', next)
}

function setStretch(cls: string) {
  const f = families.value
  let next = strip(props.modelValue, [...f.cross, ...f.crossExtra])
  if (cls && cls !== NONE) next = [...next, cls]
  emit('update:modelValue', next)
}

const NONE = '__none__'

const spacingOptions = [
  { label: 'None', value: NONE },
  { label: 'Between', value: 'justify-between' },
  { label: 'Around', value: 'justify-around' },
  { label: 'Evenly', value: 'justify-evenly' },
]

const stretchOptions = computed(() =>
  props.mode === 'container'
    ? [
        { label: 'None', value: NONE },
        { label: 'Stretch', value: 'items-stretch' },
        { label: 'Baseline', value: 'items-baseline' },
      ]
    : [
        { label: 'None', value: NONE },
        { label: 'Stretch', value: 'self-stretch' },
      ],
)

const DOT_CLASS = {
  on: 'size-2 bg-foreground',
  half: 'size-1.5 bg-muted-foreground',
  off: 'size-1 bg-muted-foreground/40',
} as const
</script>

<template>
  <!-- px-2.5 pl-8 mirrors RowUI so the label/gutter line up with the other rows -->
  <div class="relative flex items-start gap-2 min-h-9 px-2.5 pl-8 py-1.5">
    <div class="absolute left-1 top-1.5">
      <ButtonUI
        v-if="hasValue"
        variant="ghost"
        size="xs"
        :icon="RotateCcw"
        tooltip="Revert"
        class="aspect-square shrink-0 text-muted-foreground"
        @click="revert"
      />
    </div>
    <span class="w-18 shrink-0 truncate text-xs leading-7 text-foreground">
      {{ mode === 'container' ? 'Align' : 'Self align' }}
    </span>
    <div class="grid w-fit grid-cols-3 gap-0.5 rounded-lg bg-input p-1">
      <button
        v-for="i in 9"
        :key="i"
        v-tooltip="cellTitle((i - 1) % 3, Math.floor((i - 1) / 3))"
        type="button"
        class="group flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent/40"
        @click="pick((i - 1) % 3, Math.floor((i - 1) / 3))"
      >
        <span
          class="rounded-full transition-all group-hover:bg-foreground/70"
          :class="DOT_CLASS[cellState((i - 1) % 3, Math.floor((i - 1) / 3))]"
        />
      </button>
    </div>

    <!-- Spacing / Stretch escape hatches, stacked to the right of the grid -->
    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <SelectUI
        v-if="mode === 'container'"
        :options="spacingOptions"
        placeholder="Spacing"
        :model-value="spacing"
        @update:model-value="(v) => setSpacing(v ?? NONE)"
      />
      <SelectUI
        :options="stretchOptions"
        placeholder="Stretch"
        :model-value="stretch"
        @update:model-value="(v) => setStretch(v ?? NONE)"
      />
    </div>
  </div>
</template>
