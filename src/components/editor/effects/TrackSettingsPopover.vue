<script setup lang="ts">
import { computed } from 'vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import ColorFieldUI from '@/components/editor/style/ColorFieldUI.vue'
import { useSettings } from '@/composables/useSettings'
import {
  PROP_OPTIONS,
  isColor,
  isCount,
  isTrackValue,
  numText,
  setFormat,
  setTrackProp,
  trackValue,
} from '@/components/editor/effects/trackOps'
import type { AnimProp, AnimationStep } from '@/types/editor'

const props = defineProps<{ step: AnimationStep; index: number }>()

const { validTokens } = useSettings()
const colorTokens = computed(() => validTokens.value.map((t) => ({ name: t.name, value: t.value })))

const track = computed(() => props.step.tracks[props.index] ?? null)
</script>

<template>
  <div v-if="track" class="flex w-full flex-col gap-0.5 py-1.5">
    <RowUI label="Property">
      <SelectUI
        :options="PROP_OPTIONS"
        :model-value="track.prop"
        @update:model-value="(v) => v && setTrackProp(step, index, v as AnimProp)"
      />
    </RowUI>

    <template v-if="isColor(track.prop)">
      <RowUI label="From">
        <ColorFieldUI
          :model-value="String(track.from ?? '')"
          :tokens="colorTokens"
          :swatch="String(track.from ?? '#000000')"
          placeholder="from"
          @commit="(t) => (track!.from = t)"
          @pick="(v) => (track!.from = v)"
        />
      </RowUI>
      <RowUI label="To">
        <ColorFieldUI
          :model-value="String(track.to ?? '')"
          :tokens="colorTokens"
          :swatch="String(track.to ?? '#ffffff')"
          placeholder="to"
          @commit="(t) => (track!.to = t)"
          @pick="(v) => (track!.to = v)"
        />
      </RowUI>
    </template>

    <template v-else>
      <RowUI label="From">
        <ValueFieldUI
          v-tooltip="'Empty starts from the current value'"
          class="!w-full"
          :model-value="numText(track.from)"
          placeholder="auto"
          allow-negative
          :validate="isTrackValue"
          @commit="(t) => (t.trim() === '' ? (track!.from = undefined) : (track!.from = trackValue(t)))"
        />
      </RowUI>
      <RowUI label="To">
        <ValueFieldUI
          class="!w-full"
          :model-value="numText(track.to)"
          allow-negative
          :validate="isTrackValue"
          @commit="(t) => (track!.to = trackValue(t))"
        />
      </RowUI>
    </template>

    <template v-if="isCount(track.prop)">
      <RowUI label="Prefix">
        <ValueFieldUI
          :model-value="track.format?.prefix ?? ''"
          placeholder="$"
          @commit="(t) => setFormat(track!, 'prefix', t)"
        />
      </RowUI>
      <RowUI label="Decimals">
        <ValueFieldUI
          :model-value="track.format?.decimals === undefined ? '' : String(track.format.decimals)"
          placeholder="0"
          :validate="(t: string) => t.trim() === '' || /^\d{1,2}$/.test(t.trim())"
          @commit="(t) => setFormat(track!, 'decimals', t.trim() === '' ? undefined : Number(t))"
        />
      </RowUI>
      <RowUI label="Suffix">
        <ValueFieldUI
          :model-value="track.format?.suffix ?? ''"
          placeholder="+"
          @commit="(t) => setFormat(track!, 'suffix', t)"
        />
      </RowUI>
      <RowUI label="Grouping">
        <ButtonUI
          variant="outline"
          size="xs"
          class="ml-auto"
          :class="track.format?.group && 'bg-accent text-accent-foreground'"
          tooltip="Thousands separators"
          @click="setFormat(track!, 'group', !track!.format?.group)"
        >
          1,000
        </ButtonUI>
      </RowUI>
    </template>
  </div>
</template>
