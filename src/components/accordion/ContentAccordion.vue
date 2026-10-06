<script setup lang="ts">
import { inject } from 'vue'
import { accordionKey } from './context'

const accordion = inject(accordionKey)!
</script>

<template>
  <div v-if="accordion.open.value" class="flex flex-col gap-1 pt-0.5 pb-2.5">
    <slot />
  </div>
</template>
