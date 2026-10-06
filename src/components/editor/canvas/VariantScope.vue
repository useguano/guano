<script setup lang="ts">
import { provide, toRef } from 'vue'
import { VARIANT_ACTIVE, VARIANT_PICKS } from './variantScope'

// Wraps one drawing of a component on the board, publishing the variant
// options it wears — and whether it is the drawing being edited — to every
// ElementRenderer below. See ./variantScope.
const props = defineProps<{ picks: Record<string, string>; active: boolean }>()
provide(VARIANT_PICKS, toRef(props, 'picks'))
provide(VARIANT_ACTIVE, toRef(props, 'active'))
</script>

<template>
  <slot />
</template>
