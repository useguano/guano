<script setup lang="ts">
defineProps<{
  label: string
  /** 'start' for a tall control (textarea, tile): the row top-aligns and the
   * label is padded to sit on the control's first line, where a centred
   * label would float above it */
  align?: 'center' | 'start'
}>()
</script>

<template>
  <!--
    When a #start slot is provided (e.g. the revert button) we always reserve
    its gutter with pl-8 and position it absolutely, so the row doesn't shift
    when the button toggles between rendered/hidden as a field gains a value.
  -->
  <div
    data-row
    class="relative flex gap-2 min-h-9 px-2.5"
    :class="[$slots.start && 'pl-8', align === 'start' ? 'items-start' : 'items-center']"
  >
    <div v-if="$slots.start" class="absolute left-1 top-1/2 -translate-y-1/2">
      <slot name="start" />
    </div>
    <!-- block: vertical padding on an inline span does not move its text -->
    <span class="block w-18 shrink-0 truncate text-xs text-foreground" :class="align === 'start' && 'pt-1.5'">
      {{ label }}
    </span>
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <slot />
    </div>
    <slot name="end" />
  </div>
</template>
