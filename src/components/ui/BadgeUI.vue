<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    removable?: boolean
    /** 'state' tints the badge to flag a state/variant class (hover:, focus:…) */
    variant?: 'default' | 'state'
  }>(),
  { variant: 'default' },
)

defineEmits<{
  remove: []
}>()

const tone = computed(() =>
  props.variant === 'state'
    ? 'bg-state-class/15 text-state-class'
    : 'bg-secondary text-secondary-foreground',
)
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]"
    :class="tone"
  >
    <slot />
    <button
      v-if="removable"
      class="cursor-pointer opacity-60 transition-opacity hover:opacity-100"
      @click="$emit('remove')"
    >
      <X class="size-2.5" />
    </button>
  </span>
</template>
