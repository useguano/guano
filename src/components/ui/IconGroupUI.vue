<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  options: { label: string; value: string; icon: Component }[]
}>()

const model = defineModel<string>()
</script>

<template>
  <div class="flex w-full divide-x divide-accent overflow-hidden rounded-xl border border-accent">
    <button
      v-for="opt in options"
      :key="opt.value"
      v-tooltip="opt.label"
      type="button"
      class="flex h-8 flex-1 items-center justify-center transition-colors outline-none focus-visible:bg-accent/30 [&_svg]:size-3.5"
      :class="
        model === opt.value
          ? 'bg-accent/30 text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground'
      "
      @click="model = opt.value"
    >
      <component :is="opt.icon" />
    </button>
  </div>
</template>
