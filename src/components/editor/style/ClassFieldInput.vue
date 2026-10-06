<script setup lang="ts">
import { ref } from 'vue'
import ClassInput from '@/components/editor/style/ClassInput.vue'
import { useClassField } from '@/composables/useClassField'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** auto-add flex/grid prerequisites (off for transition to-states) */
    prerequisites?: boolean
  }>(),
  { prerequisites: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { tokens, setTokens, removeToken } = useClassField({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const input = ref<InstanceType<typeof ClassInput>>()
defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <ClassInput
    ref="input"
    :tokens="tokens"
    :prerequisites="prerequisites"
    @commit="setTokens"
    @remove="removeToken"
  />
</template>
