<script setup lang="ts">
import { provide } from 'vue'
import { FRAME_BREAKPOINT } from './frameScope'

// Wraps one breakpoint frame's element tree, publishing that frame's breakpoint
// id to every descendant ElementRenderer so they can tell whether they're in
// the frame currently being edited. The id is stable per frame instance (keyed
// by bp.id in the v-for), so a plain value is fine.
const props = defineProps<{ breakpointId: string }>()
provide(FRAME_BREAKPOINT, props.breakpointId)
</script>

<template>
  <slot />
</template>
