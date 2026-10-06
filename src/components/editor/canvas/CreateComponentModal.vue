<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ModalContent from '@/components/modal/ModalContent.vue'
import ModalActions from '@/components/modal/ModalActions.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useComponents } from '@/composables/useComponents'

// opened via useModal from the canvas context menu; targetId is the element
// being turned into a component
const props = defineProps<{ targetId: string }>()
const emit = defineEmits<{ close: [] }>()

const { createComponent } = useComponents()

const name = ref('')
const nameInput = ref<InstanceType<typeof InputUI>>()

onMounted(() => nextTick(() => nameInput.value?.focus()))

function submit() {
  if (!name.value.trim()) return
  createComponent(name.value, props.targetId)
  emit('close')
}
</script>

<template>
  <ModalHost size="sm" @close="emit('close')">
    <ModalHeader title="Create component" @close="emit('close')" />
    <ModalContent>
      <p class="text-xs text-muted-foreground">
        The element becomes a shared component you can reuse anywhere as
        <span class="font-mono">:Name:</span>.
      </p>
      <InputUI ref="nameInput" v-model="name" placeholder="e.g. Hero" @keydown.enter="submit" />
    </ModalContent>
    <ModalActions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI variant="default" size="sm" :disabled="!name.trim()" @click="submit">
        Create
      </ButtonUI>
    </ModalActions>
  </ModalHost>
</template>
