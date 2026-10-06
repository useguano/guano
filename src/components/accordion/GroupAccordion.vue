<script setup lang="ts">
import { provide } from 'vue'
import { accordionKey } from './context'

const open = defineModel<boolean>('open', { default: true })

provide(accordionKey, {
  open,
  toggle: () => (open.value = !open.value),
})
</script>

<template>
  <div class="border-b border-input last:border-b-0">
    <slot />
  </div>
</template>
