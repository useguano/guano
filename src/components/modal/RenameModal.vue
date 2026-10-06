<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ModalContent from '@/components/modal/ModalContent.vue'
import ModalActions from '@/components/modal/ModalActions.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'

// A one-field rename dialog, opened through useModal: resolves with the new
// name, or null when dismissed. Replaces inline renames where a text field
// swapping into a tile or row was easy to miss and easy to blur by accident.
const props = withDefaults(
  defineProps<{
    title?: string
    value: string
    placeholder?: string
    confirmLabel?: string
  }>(),
  { title: 'Rename', confirmLabel: 'Rename' },
)
const emit = defineEmits<{ close: [name?: string] }>()

const name = ref(props.value)
const input = ref<InstanceType<typeof InputUI>>()
onMounted(() => nextTick(() => input.value?.focus()))

function submit() {
  const next = name.value.trim()
  if (!next || next === props.value) return emit('close')
  emit('close', next)
}
</script>

<template>
  <ModalHost size="sm" @close="emit('close')">
    <ModalHeader :title="title" @close="emit('close')" />
    <ModalContent>
      <InputUI ref="input" v-model="name" :placeholder="placeholder" @keydown.enter="submit" />
    </ModalContent>
    <ModalActions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI variant="default" size="sm" :disabled="!name.trim()" @click="submit">
        {{ confirmLabel }}
      </ButtonUI>
    </ModalActions>
  </ModalHost>
</template>
