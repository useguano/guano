<script setup lang="ts">
import { Component as ComponentIcon } from 'lucide-vue-next'
import { useInsertDrag } from '@/composables/useInsertDrag'

const { payload, pointer } = useInsertDrag()
</script>

<template>

  <Teleport to="body">
    <div
      v-if="payload"
      class="pointer-events-none fixed z-[100] flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-xs shadow-md"
      :style="{ left: `${pointer.x + 14}px`, top: `${pointer.y + 14}px` }"
    >
      <component
        :is="payload.kind === 'element' ? payload.icon : ComponentIcon"
        class="size-3.5 shrink-0"
        :class="payload.kind === 'element' ? 'text-muted-foreground' : 'text-success'"
      />
      <span>{{ payload.kind === 'element' ? payload.label : payload.name }}</span>
    </div>
  </Teleport>
</template>
