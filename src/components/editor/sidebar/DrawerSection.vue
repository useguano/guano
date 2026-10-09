<script setup lang="ts">

defineProps<{ title: string }>()
</script>

<template>
  <section class="flex flex-col gap-2">
    <div class="flex items-center gap-1">
      <h3 class="min-w-0 flex-1 truncate section-label">
        {{ title }}
      </h3>
      <slot name="action" />
    </div>
    <div class="flex flex-col gap-2.5">
      <slot />
    </div>
  </section>
</template>
