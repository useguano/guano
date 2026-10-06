<script setup lang="ts">
import { inject } from 'vue'
import { tabsKey } from './context'

const props = defineProps<{ id: string }>()

const tabs = inject(tabsKey)!
</script>

<template>
  <!-- enter-only: panels are siblings each with their own v-if, so a leave
       would overlap the next panel; the new one simply settles into place -->
  <Transition name="tab-panel" appear>
    <div v-if="tabs.active.value === props.id" class="flex flex-col">
      <slot />
    </div>
  </Transition>
</template>

<style scoped>
.tab-panel-enter-active {
  transition:
    opacity 0.3s ease-out,
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.tab-panel-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
@media (prefers-reduced-motion: reduce) {
  .tab-panel-enter-active {
    transition: none;
  }
}
</style>
