<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ModalContent from '@/components/modal/ModalContent.vue'
import ModalActions from '@/components/modal/ModalActions.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useCollections } from '@/composables/useCollections'

const emit = defineEmits<{
  close: []
}>()

const { createCollection } = useCollections()

const name = ref('')
const nameInput = ref<InstanceType<typeof InputUI>>()

onMounted(() => nextTick(() => nameInput.value?.focus()))

function submit() {
  if (!name.value.trim()) return
  createCollection(name.value)
  emit('close')
}
</script>

<template>
  <ModalHost size="sm" @close="emit('close')">
    <ModalHeader title="Create collection" @close="emit('close')" />
    <ModalContent>
      <p class="text-xs text-muted-foreground">
        A collection is a content type (post, product…) with its own fields, template page, and
        entries. Call it anywhere with
        <span class="font-mono">:collection-list[name]</span>.
      </p>
      <InputUI ref="nameInput" v-model="name" placeholder="e.g. post" @keydown.enter="submit" />
    </ModalContent>
    <ModalActions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI variant="default" size="sm" :disabled="!name.trim()" @click="submit">
        Create
      </ButtonUI>
    </ModalActions>
  </ModalHost>
</template>
