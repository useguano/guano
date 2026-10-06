<script setup lang="ts">
import { computed } from 'vue'
import RowUI from '@/components/ui/RowUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import { SPACING } from '@/lib/tieredBox'
import { parseTail, buildTailClass, classToText, textToClass, nearestStepIndex } from '@/lib/valueClass'
import { UnfoldHorizontal, FoldHorizontal, RotateCcw } from 'lucide-vue-next'

// Gap as a slider row with a button to split into independent X (column) and
// Y (row) gaps. Unified writes `gap-N`; split writes `gap-x-N` + `gap-y-N`.

const props = defineProps<{
  modelValue: string[]
  /** the element's classes at selection time — revert hides when back to this */
  baseline?: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const STOPS = SPACING
const MAX = STOPS.length - 1
const ALL = ['gap', 'gap-x', 'gap-y']

const split = computed(() =>
  props.modelValue.some((c) => c.startsWith('gap-x-') || c.startsWith('gap-y-')),
)

function gapTokens(list: string[]): string {
  return list
    .filter((c) => c.startsWith('gap-'))
    .sort()
    .join(' ')
}

// dirty only when the gap classes differ from the selection-time baseline
const hasGap = computed(() => gapTokens(props.modelValue) !== gapTokens(props.baseline ?? []))

function revert() {
  const restore = (props.baseline ?? []).filter((c) => c.startsWith('gap-'))
  emit('update:modelValue', [...strip(ALL), ...restore])
}

// gap-x-* / gap-y-* both start with 'gap-', so strip axis tokens explicitly
function strip(prefixes: string[]): string[] {
  return props.modelValue.filter((c) => !prefixes.some((p) => c.startsWith(`${p}-`)))
}

// the token / value text / tail currently set for a gap prefix
function tokenFor(prefix: string): string | undefined {
  return props.modelValue.find((c) => parseTail(c, prefix) !== null)
}
function valueText(prefix: string): string {
  return classToText(prefix, tokenFor(prefix))
}
function tailFor(prefix: string): string {
  const token = tokenFor(prefix)
  return token ? parseTail(token, prefix)! : '0'
}
function sliderIdx(prefix: string): number {
  const near = nearestStepIndex(STOPS, valueText(prefix))
  return near === -1 ? 0 : near
}

// --- writes ---

function setUnifiedClass(cls: string | null) {
  emit('update:modelValue', [...strip(ALL), ...(cls ? [cls] : [])])
}
function setAxisClass(prefix: 'gap-x' | 'gap-y', cls: string | null) {
  const other = prefix === 'gap-x' ? 'gap-y' : 'gap-x'
  const keep = tokenFor(other) ?? `${other}-${STOPS[0]}`
  emit('update:modelValue', [...strip(ALL), ...(cls ? [cls] : []), keep])
}

// slider drag → clean scale class; text commit → custom (guarded) class
function setUnifiedStop(i: number) {
  setUnifiedClass(`gap-${STOPS[i]}`)
}
function setUnifiedText(text: string) {
  const cls = textToClass('gap', text)
  if (cls !== false) setUnifiedClass(cls)
}
function setAxisStop(prefix: 'gap-x' | 'gap-y', i: number) {
  setAxisClass(prefix, `${prefix}-${STOPS[i]}`)
}
function setAxisText(prefix: 'gap-x' | 'gap-y', text: string) {
  const cls = textToClass(prefix, text)
  if (cls !== false) setAxisClass(prefix, cls)
}

function enableSplit() {
  const tail = tailFor('gap')
  emit('update:modelValue', [...strip(ALL), buildTailClass('gap-x', tail), buildTailClass('gap-y', tail)])
}
function disableSplit() {
  // collapse back to a single gap using the X value
  emit('update:modelValue', [...strip(ALL), buildTailClass('gap', tailFor('gap-x'))])
}
</script>

<template>
  <template v-if="!split">
    <RowUI label="Gap">
      <template #start>
        <ButtonUI
          v-if="hasGap"
          variant="ghost"
          size="xs"
          :icon="RotateCcw"
          tooltip="Revert"
          class="aspect-square shrink-0 text-muted-foreground"
          @click="revert"
        />
      </template>
      <SliderUI :min="0" :max="MAX" :model-value="sliderIdx('gap')" @update:model-value="setUnifiedStop" />
      <ValueFieldUI :model-value="valueText('gap')" :steps="STOPS" @commit="setUnifiedText" />
      <ButtonUI
        variant="ghost"
        size="xs"
        :icon="UnfoldHorizontal"
        tooltip="Split into X and Y"
        class="aspect-square shrink-0 text-muted-foreground"
        @click="enableSplit"
      />
    </RowUI>
  </template>

  <template v-else>
    <RowUI label="Gap X">
      <template #start>
        <ButtonUI
          v-if="hasGap"
          variant="ghost"
          size="xs"
          :icon="RotateCcw"
          tooltip="Revert"
          class="aspect-square shrink-0 text-muted-foreground"
          @click="revert"
        />
      </template>
      <SliderUI
        :min="0"
        :max="MAX"
        :model-value="sliderIdx('gap-x')"
        @update:model-value="(v) => setAxisStop('gap-x', v)"
      />
      <ValueFieldUI :model-value="valueText('gap-x')" :steps="STOPS" @commit="(t) => setAxisText('gap-x', t)" />
      <ButtonUI
        variant="ghost"
        size="xs"
        :icon="FoldHorizontal"
        tooltip="Merge X and Y"
        class="aspect-square shrink-0 text-muted-foreground"
        @click="disableSplit"
      />
    </RowUI>
    <RowUI label="Gap Y">
      <!-- empty gutter keeps Gap Y's left inset aligned with Gap X -->
      <template #start><span class="block size-6" /></template>
      <SliderUI
        :min="0"
        :max="MAX"
        :model-value="sliderIdx('gap-y')"
        @update:model-value="(v) => setAxisStop('gap-y', v)"
      />
      <ValueFieldUI :model-value="valueText('gap-y')" :steps="STOPS" @commit="(t) => setAxisText('gap-y', t)" />
    </RowUI>
  </template>
</template>
