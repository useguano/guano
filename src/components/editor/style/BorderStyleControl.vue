<script setup lang="ts">
import { computed } from 'vue'
import { Ban } from 'lucide-vue-next'

// Border-style as a segmented button group with real line previews
// (solid / dashed / dotted / double / none), writing the border-<style> class.

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const STYLES = [
  { cls: 'border-solid', label: 'Solid', css: 'solid' },
  { cls: 'border-dashed', label: 'Dashed', css: 'dashed' },
  { cls: 'border-dotted', label: 'Dotted', css: 'dotted' },
  { cls: 'border-double', label: 'Double', css: 'double' },
  { cls: 'border-none', label: 'None', css: 'none' },
] as const

const current = computed(() => props.modelValue.find((t) => STYLES.some((s) => s.cls === t)) ?? '')

function pick(cls: string) {
  const next = props.modelValue.filter((t) => !STYLES.some((s) => s.cls === t))
  next.push(cls)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="flex w-full divide-x divide-accent overflow-hidden rounded-xl border border-accent">
    <button
      v-for="s in STYLES"
      :key="s.cls"
      v-tooltip="s.label"
      type="button"
      class="flex h-8 flex-1 items-center justify-center transition-colors outline-none focus-visible:bg-accent/30"
      :class="
        current === s.cls
          ? 'bg-accent/30 text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground'
      "
      @click="pick(s.cls)"
    >
      <Ban v-if="s.css === 'none'" class="size-3.5" />
      <span
        v-else
        class="block w-4 border-current"
        :style="{ borderTopStyle: s.css, borderTopWidth: s.css === 'double' ? '3px' : '2px' }"
      />
    </button>
  </div>
</template>
