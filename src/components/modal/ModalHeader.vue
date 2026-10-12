<script setup lang="ts">
import { inject, onMounted, useId, type Component } from 'vue'
import { Search, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { MODAL_LABEL } from './labelKey'

const props = defineProps<{
  title: string
  id?: string
  icon?: Component
  search?: string
  searchPlaceholder?: string
}>()

const generated = useId()
const headingId = props.id ?? generated
const register = inject(MODAL_LABEL, null)
onMounted(() => register?.(headingId))

defineEmits<{
  close: []
  'update:search': [value: string]
}>()
</script>

<template>
  <header class="flex shrink-0 items-center gap-2 border-b border-input py-2.5 pr-1.5 pl-4">
    <div class="flex min-w-0 items-center gap-2">
      <component :is="icon" v-if="icon" class="size-4 shrink-0 text-muted-foreground" />
      <p :id="headingId" class="truncate text-xs font-medium">{{ title }}</p>
    </div>
    <div class="flex-1" />

    <div v-if="search !== undefined" class="relative w-64 shrink-0">
      <Search
        class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        :value="search"
        type="text"
        spellcheck="false"
        :placeholder="searchPlaceholder"
        class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
        @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <ButtonUI
      variant="icon"
      size="sm"
      :icon="X"
      aria-label="Close"
      class="w-7 text-muted-foreground"
      @click="$emit('close')"
    />
  </header>
</template>
