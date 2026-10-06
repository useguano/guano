<script setup lang="ts">
import { inject } from 'vue'
import { tabsKey } from './context'

const props = defineProps<{ id: string; label?: string }>()

const tabs = inject(tabsKey)!
</script>

<template>
  <button
    type="button"
    class="cursor-pointer rounded-lg px-2 py-1 text-xs transition-colors"
    :class="
      tabs.active.value === props.id
        ? 'bg-input text-foreground'
        : 'text-muted-foreground hover:text-foreground'
    "
    @click="tabs.select(props.id)"
  >
    <slot>{{ label }}</slot>
  </button>
</template>
