<script setup lang="ts">
import { inject, onMounted, useId } from 'vue'
import { X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { MODAL_LABEL } from './labelKey'

const props = defineProps<{
  title: string
  id?: string
}>()

const generated = useId()
const headingId = props.id ?? generated
const register = inject(MODAL_LABEL, null)
onMounted(() => register?.(headingId))

defineEmits<{
  close: []
}>()
</script>

<template>
  <header class="flex h-10 items-center justify-between border-b border-input pr-1.5 pl-4">
    <p :id="headingId" class="text-xs font-medium">{{ title }}</p>

    <ButtonUI
      variant="icon"
      size="sm"
      :icon="X"
      tooltip="Close"
      class="w-7 text-muted-foreground"
      @click="$emit('close')"
    />
  </header>
</template>
