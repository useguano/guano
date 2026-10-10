<script setup lang="ts">
import { computed } from 'vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import { EASING_NAMES } from '@/lib/motion'
import type { AnimationStep } from '@/types/editor'

const props = defineProps<{ step: AnimationStep; index: number }>()

const EASING_OPTIONS = EASING_NAMES.map((e) => ({ label: e, value: e }))

const step = computed(() => props.step)

function setNum<T, K extends keyof T>(obj: T, key: K, text: string, fallback = 0) {
  const n = parseFloat(text)
  obj[key] = (text.trim() === '' ? fallback : isFinite(n) ? n : fallback) as T[K]
}
</script>

<template>
  <div class="flex w-full flex-col gap-0.5 py-1.5">
    <RowUI label="Duration">
      <ValueFieldUI
        unit="ms"
        :model-value="String(step.duration)"
        @commit="(t) => setNum(step, 'duration', t, 400)"
      />
    </RowUI>

    <RowUI label="Easing">
      <SelectUI
        :options="EASING_OPTIONS"
        :model-value="step.easing"
        @update:model-value="(v) => v && (step.easing = v)"
      />
    </RowUI>

    <RowUI :label="index > 0 ? 'Offset' : 'Delay'">
      <ValueFieldUI
        v-tooltip="index > 0 ? 'Negative overlaps the step before' : 'Before this step runs'"
        unit="ms"
        :model-value="String(step.offset ?? 0)"
        :allow-negative="index > 0"
        @commit="
          (t) => (t.trim() === '' || t === '0' ? (step.offset = undefined) : setNum(step, 'offset', t))
        "
      />
    </RowUI>

    <RowUI label="Stagger">
      <ValueFieldUI
        v-tooltip="'Per child'"
        unit="ms"
        :model-value="String(step.stagger ?? 0)"
        @commit="
          (t) => (t.trim() === '' || t === '0' ? (step.stagger = undefined) : setNum(step, 'stagger', t))
        "
      />
    </RowUI>

    <RowUI v-if="step.stagger" label="Cascade">
      <InputUI
        :model-value="step.staggerSelector ?? ''"
        placeholder="direct children"
        class="font-mono"
        @update:model-value="(v) => (step.staggerSelector = v.trim() || undefined)"
      />
    </RowUI>

    <p v-if="step.stagger" class="px-2.5 pb-1 text-[10px] text-muted-foreground">
      Staggered properties move the children; the step's other properties still move this element.
    </p>

    <RowUI label="Repeat">
      <div class="flex min-w-0 flex-1 items-center gap-1">
        <ValueFieldUI
          v-tooltip="'Extra plays after the first — −1 repeats forever'"
          full
          :model-value="String(step.repeat ?? 0)"
          allow-negative
          @commit="
            (t) => (t.trim() === '' || t === '0' ? (step.repeat = undefined) : setNum(step, 'repeat', t))
          "
        />
        <ButtonUI
          :variant="step.yoyo ? 'outline' : 'ghost'"
          size="xs"
          class="shrink-0"
          :class="step.yoyo ? '' : 'text-muted-foreground opacity-60'"
          tooltip="Play each repeat back and forth"
          :aria-pressed="!!step.yoyo"
          @click="step.yoyo = step.yoyo ? undefined : true"
        >
          Yoyo
        </ButtonUI>
      </div>
    </RowUI>
  </div>
</template>
