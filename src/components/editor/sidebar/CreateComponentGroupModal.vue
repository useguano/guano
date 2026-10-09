<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ModalContent from '@/components/modal/ModalContent.vue'
import ModalActions from '@/components/modal/ModalActions.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'

const emit = defineEmits<{ close: [name?: string] }>()

const name = ref('')
const nameInput = ref<InstanceType<typeof InputUI>>()

onMounted(() => nextTick(() => nameInput.value?.focus()))

function submit() {
  const value = name.value.trim()
  if (!value) return
  emit('close', value)
}
</script>

<template>
  <ModalHost size="sm" @close="emit('close')">
    <ModalHeader title="New group" @close="emit('close')" />
    <ModalContent>
      <p class="text-xs text-muted-foreground">
        A group is how this list is organised — Cards, Navigation. It exists for as long as a
        component sits in it.
      </p>
      <InputUI ref="nameInput" v-model="name" placeholder="e.g. Cards" @keydown.enter="submit" />
    </ModalContent>
    <ModalActions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI variant="default" size="sm" :disabled="!name.trim()" @click="submit">
        Create
      </ButtonUI>
    </ModalActions>
  </ModalHost>
</template>
