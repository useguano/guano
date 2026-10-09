<script setup lang="ts">
defineProps<{
  label: string

  align?: 'center' | 'start'
}>()
</script>

<template>

  <div
    data-row
    class="relative flex gap-2 min-h-9 px-2.5"
    :class="[$slots.start && 'pl-8', align === 'start' ? 'items-start' : 'items-center']"
  >
    <div v-if="$slots.start" class="absolute left-1 top-1/2 -translate-y-1/2">
      <slot name="start" />
    </div>
    <span class="block w-18 shrink-0 truncate text-xs text-foreground" :class="align === 'start' && 'pt-1.5'">
      {{ label }}
    </span>
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <slot />
    </div>
    <slot name="end" />
  </div>
</template>
