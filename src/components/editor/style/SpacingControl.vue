<script setup lang="ts">
import SpacingBoxControl from '@/components/editor/style/SpacingBoxControl.vue'

// Padding + Margin, each a cross of four side steppers with a lock (no tier
// switch). Margin allows negative values.
defineProps<{ modelValue: string[]; baseline?: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()
const update = (v: string[]) => emit('update:modelValue', v)
</script>

<template>
  <div class="flex flex-col gap-3 py-1">
    <SpacingBoxControl
      label="Padding"
      base="p"
      :model-value="modelValue"
      :baseline="baseline"
      @update:model-value="update"
    />
    <SpacingBoxControl
      label="Margin"
      base="m"
      allow-negative
      :allow-keywords="['auto']"
      :model-value="modelValue"
      :baseline="baseline"
      class="border-t border-input pt-3"
      @update:model-value="update"
    />
  </div>
</template>
