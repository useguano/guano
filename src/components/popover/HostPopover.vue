<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { Component } from 'vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'

defineProps<{
  title: string
  icon?: Component
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="z-50 w-84 rounded-2xl border border-input bg-background shadow-xl">
    <header class="flex items-center justify-between border-b border-input pr-1 pl-3 py-1">
      <p class="flex items-center gap-1.5 text-xs font-medium">
        <component :is="icon" v-if="icon" class="size-3.5 shrink-0 text-muted-foreground" />
        {{ title }}
      </p>
      <ButtonUI variant="icon" size="sm" :icon="X" class="w-7 text-muted-foreground" @click="$emit('close')" />
    </header>
    <div class="custom-scrollbar flex max-h-[70vh] flex-col overflow-x-hidden overflow-y-auto">
      <slot />
    </div>
  </div>
</template>
