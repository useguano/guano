<script setup lang="ts">
import { ref } from 'vue'

withDefaults(
  defineProps<{
    placeholder?: string
    rows?: number
  }>(),
  { rows: 3 },
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
    class="w-full resize-y rounded-lg bg-input px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
  />
</template>
