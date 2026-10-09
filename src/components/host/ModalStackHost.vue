<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useModal } from '@/composables/useModal'

const { stack, closeTop } = useModal()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && stack.value.length) {
    e.stopPropagation()
    closeTop()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>

  <TransitionGroup name="modal">
    <component
      :is="entry.component"
      v-for="entry in stack"
      :key="entry.id"
      v-bind="entry.props"
      @close="closeTop($event)"
    />
  </TransitionGroup>
</template>
