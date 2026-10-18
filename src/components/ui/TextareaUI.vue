<script setup lang="ts">
import { ref } from 'vue'

withDefaults(
  defineProps<{
    placeholder?: string
    rows?: number
    variant?: 'default' | 'bare'
  }>(),
  { rows: 3, variant: 'default' },
)

const model = defineModel<string>({ default: '' })

const el = ref<HTMLTextAreaElement>()
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <textarea
    ref="el"
    v-model="model"
    :rows="rows"
    spellcheck="false"
    :placeholder="placeholder"
    class="w-full text-xs outline-none placeholder:text-muted-foreground"
    :class="
      variant === 'bare'
        ? 'resize-none bg-transparent px-0 py-0'
        : 'resize-y rounded-lg bg-input px-2 py-1.5 focus-visible:ring-2 focus-visible:ring-accent'
    "
  />
</template>
