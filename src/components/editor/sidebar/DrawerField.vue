<script setup lang="ts">

defineProps<{
  label: string
  hint?: string
}>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-[10px] font-medium text-muted-foreground">
        {{ label }}
      </span>
      <slot name="end" />
    </div>
    <slot />
    <p v-if="hint" class="text-[10px] text-muted-foreground">{{ hint }}</p>
  </div>
</template>
