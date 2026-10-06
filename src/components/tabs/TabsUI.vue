<script setup lang="ts">
import { provide } from 'vue'
import { tabsKey } from './context'

const active = defineModel<string>('active', { required: true })

provide(tabsKey, { active, select: (id: string) => (active.value = id) })
</script>

<template>
  <div class="flex flex-col gap-2">
    <slot />
  </div>
</template>
