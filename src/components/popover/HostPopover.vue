<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { Component } from 'vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'

const props = withDefaults(
  defineProps<{
    title: string
    icon?: Component

    width?: string

    header?: boolean

    scroll?: boolean
  }>(),
  { width: 'w-84', header: true, scroll: true },
)

defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="z-50 rounded-2xl border border-input bg-background shadow-xl" :class="props.width">
    <header v-if="header" class="flex items-center justify-between border-b border-input pr-1 pl-3 py-1">
      <p class="flex items-center gap-1.5 text-xs font-medium">
        <component :is="icon" v-if="icon" class="size-3.5 shrink-0 text-muted-foreground" />
        {{ title }}
      </p>
      <ButtonUI variant="icon" size="sm" :icon="X" class="w-7 text-muted-foreground" @click="$emit('close')" />
    </header>
    <div
      class="flex flex-col"
      :class="scroll ? 'custom-scrollbar max-h-[70vh] overflow-x-hidden overflow-y-auto' : ''"
    >
      <slot />
    </div>
  </div>
</template>
