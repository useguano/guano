<script setup lang="ts">
defineProps<{
  label?: string
}>()
</script>

<template>
  <div class="flex flex-col gap-1.5 border-b border-input p-3 last:border-b-0">
    <p v-if="label" class="text-xs font-medium text-muted-foreground">{{ label }}</p>
    <slot />
  </div>
</template>
