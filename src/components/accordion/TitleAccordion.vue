<script setup lang="ts">
import { inject } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { accordionKey } from './context'

const accordion = inject(accordionKey)!
</script>

<template>
  <div
    class="group flex h-8 cursor-pointer items-center justify-between pr-1 pl-2.5 select-none"
    @click="accordion.toggle()"
  >
    <span
      class="flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase transition-colors"
      :class="accordion.open.value ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'"
    >
      <ChevronRight
        class="size-3 text-muted-foreground transition-transform"
        :class="accordion.open.value && 'rotate-90'"
      />
      <slot />
    </span>
    <span @click.stop>
      <slot name="action" />
    </span>
  </div>
</template>
