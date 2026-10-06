<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import ModalDialog from '@/components/modal/ModalDialog.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'

// Reusable destructive-confirm dialog, opened via useModal().confirm() —
// closes with `true` when confirmed, no payload when dismissed.
withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string }>(), {
  confirmLabel: 'Delete',
})
const emit = defineEmits<{ close: [result?: boolean] }>()

// Focus the destructive action itself. It is what the dialog is FOR, and a
// screen-reader user otherwise has to hunt for it; the role below is what
// makes the message be read out on open rather than merely drawn.
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
