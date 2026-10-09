<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import ModalDialog from '@/components/modal/ModalDialog.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'

withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string }>(), {
  confirmLabel: 'Delete',
})
const emit = defineEmits<{ close: [result?: boolean] }>()

const confirmBtn = useTemplateRef<{ $el: HTMLElement } | HTMLElement>('confirmBtn')
onMounted(() => {
  const el = confirmBtn.value
  const node = el && '$el' in el ? el.$el : el
  node?.focus?.()
})
</script>

<template>
  <ModalDialog :title="title" size="sm" role="alertdialog" @close="emit('close')">
    <p class="text-xs text-muted-foreground">{{ message }}</p>
    <template #actions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI ref="confirmBtn" variant="danger" size="sm" @click="emit('close', true)">
        {{ confirmLabel }}
      </ButtonUI>
    </template>
  </ModalDialog>
</template>
