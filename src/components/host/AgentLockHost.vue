<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { useLiveSync, agentLocked, agentWriteCount } from '@/composables/useLiveSync'
import ButtonUI from '@/components/ui/ButtonUI.vue'

// Hard lock while an AI agent (MCP) is editing the active branch: a scrim
// blocks every pointer interaction (the canvas stays visible underneath —
// that's the live show) and a capture-phase keydown listener swallows
// shortcuts (⌘Z, delete, typing) that would mutate mid-session. The only
// affordance is Take over, which breaks the lock deliberately.

const { takeOver } = useLiveSync()

function swallowKeys(e: KeyboardEvent) {
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
    class="fixed inset-0 z-100 bg-background/20 backdrop-blur-xs"
    @wheel.prevent
    @touchmove.prevent
    @contextmenu.prevent
  >
    <div
      class="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-3xl bg-background p-4 shadow-xl"
    >
      <span class="relative flex size-2.5 ml-2">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-pending opacity-75" />
        <span class="relative inline-flex size-2.5 rounded-full bg-pending" />
      </span>
      <span class="text-sm">
        An AI agent is editing this project —
        {{ agentWriteCount }} update{{ agentWriteCount === 1 ? '' : 's' }} applied live
      </span>
      <ButtonUI size="sm" variant="outline" @click="takeOver">Take over</ButtonUI>
    </div>
  </div>
</template>
