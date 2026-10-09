<script setup lang="ts">
import { provide } from 'vue'
import { FRAME_BREAKPOINT } from './frameScope'

const props = defineProps<{ breakpointId: string }>()
provide(FRAME_BREAKPOINT, props.breakpointId)
</script>

<template>
  <slot />
</template>
