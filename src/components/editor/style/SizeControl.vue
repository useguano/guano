<script setup lang="ts">
import { reactive } from 'vue'
import RowUI from '@/components/ui/RowUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import { sizeTextToClass, sizeClassToText, isSizeValue, nearestStepIndex } from '@/lib/valueClass'
import { Plus, Minus, X } from 'lucide-vue-next'

// Width / Height as slider + editable value. Each row has a (+) that reveals its
// Min & Max constraint rows (same control), which can be removed individually.
// The value field also accepts keywords/fractions (full, screen, 1/2…).

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

// slider scale for size (nearest-stop for off-scale/keyword values)
const STEPS = ['0', '4', '8', '12', '16', '20', '24', '32', '40', '48', '56', '64', '80', '96']
const MAX = STEPS.length - 1

const DIMENSIONS = [
  { key: 'w', label: 'Width', min: 'min-w', max: 'max-w' },
  { key: 'h', label: 'Height', min: 'min-h', max: 'max-h' },
] as const

function tokenFor(prefix: string): string | undefined {
  return props.modelValue.find((c) => c.startsWith(`${prefix}-`))
}
function valueText(prefix: string): string {
  return sizeClassToText(prefix, tokenFor(prefix))
}
function sliderIndex(prefix: string): number {
  const near = nearestStepIndex(STEPS, valueText(prefix))
  return near === -1 ? 0 : near
}

function setClass(prefix: string, cls: string | null) {
  const next = props.modelValue.filter((c) => !c.startsWith(`${prefix}-`))
  if (cls) next.push(cls)
  emit('update:modelValue', next)
}
function setStop(prefix: string, i: number) {
  setClass(prefix, `${prefix}-${STEPS[i]}`)
}
function setText(prefix: string, text: string) {
  const cls = sizeTextToClass(prefix, text)
  if (cls !== false) setClass(prefix, cls)
}

// a dimension's constraints show when already set, or after the user expands it
const expanded = reactive<Record<string, boolean>>(
  Object.fromEntries(
    DIMENSIONS.map((d) => [d.key, !!(tokenFor(d.min) || tokenFor(d.max))]),
  ),
)
function toggle(key: string) {
  expanded[key] = !expanded[key]
}
function removeConstraint(prefix: string) {
  setClass(prefix, null)
}
</script>

<template>
  <div class="flex flex-col">
    <template v-for="d in DIMENSIONS" :key="d.key">
      <RowUI :label="d.label">
        <SliderUI
          :min="0"
          :max="MAX"
          :model-value="sliderIndex(d.key)"
          @update:model-value="(v) => setStop(d.key, v)"
        />
        <ValueFieldUI
          :model-value="valueText(d.key)"
          :validate="isSizeValue"
          :steps="STEPS"
          @commit="(t) => setText(d.key, t)"
        />
        <ButtonUI
          variant="ghost"
          size="xs"
          :icon="expanded[d.key] ? Minus : Plus"
          :tooltip="expanded[d.key] ? 'Hide min & max' : 'Add min & max'"
          class="aspect-square shrink-0 text-muted-foreground"
          @click="toggle(d.key)"
        />
      </RowUI>

      <!-- indented + left rule so min/max read as children of their dimension -->
      <div v-if="expanded[d.key]" class="ml-4 border-l border-input">
        <RowUI
          v-for="c in [
            { prefix: d.min, label: 'Min' },
            { prefix: d.max, label: 'Max' },
          ]"
          :key="c.prefix"
          :label="c.label"
        >
          <SliderUI
            :min="0"
            :max="MAX"
            :model-value="sliderIndex(c.prefix)"
            @update:model-value="(v) => setStop(c.prefix, v)"
          />
          <ValueFieldUI
            :model-value="valueText(c.prefix)"
            :validate="isSizeValue"
            :steps="STEPS"
            @commit="(t) => setText(c.prefix, t)"
          />
          <ButtonUI
            variant="ghost"
            size="xs"
            :icon="X"
            tooltip="Remove"
            class="aspect-square shrink-0 text-muted-foreground"
            @click="removeConstraint(c.prefix)"
          />
        </RowUI>
      </div>
    </template>
  </div>
</template>
