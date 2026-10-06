<script setup lang="ts">
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
    :class="model ? 'bg-foreground' : 'bg-accent'"
    @click="model = !model"
  >
    <span
      class="inline-block size-3 rounded-full bg-background transition-transform"
      :class="model ? 'translate-x-3.5' : 'translate-x-0.5'"
    />
  </button>
</template>
