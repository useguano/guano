<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { useLiveSync, agentLocked, agentWriteCount } from '@/composables/useLiveSync'
import ButtonUI from '@/components/ui/ButtonUI.vue'

const { takeOver } = useLiveSync()

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

function swallowKeys(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest?.(EDITABLE)) return
  e.stopPropagation()
  e.preventDefault()
}

watch(
  agentLocked,
  (locked) => {
    if (locked) window.addEventListener('keydown', swallowKeys, true)
    else window.removeEventListener('keydown', swallowKeys, true)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.removeEventListener('keydown', swallowKeys, true))
</script>

<template>
  <div
    v-if="agentLocked"
    data-agent-lock
    class="absolute inset-0 z-50 bg-background/20 backdrop-blur-xs"
    @wheel.prevent
    @touchmove.prevent
    @contextmenu.prevent
  >
    <div
      class="absolute bottom-14 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-3xl border border-input bg-background p-3 pl-4 shadow-xl"
    >
      <span class="relative flex size-2.5 ml-2">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-pending opacity-75" />
        <span class="relative inline-flex size-2.5 rounded-full bg-pending" />
      </span>
      <span class="text-xs">
        The AI is editing —
        {{ agentWriteCount }} update{{ agentWriteCount === 1 ? '' : 's' }} applied live
      </span>
      <ButtonUI size="sm" variant="outline" @click="takeOver">Take over</ButtonUI>
    </div>
  </div>
</template>
