<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useNotice } from '@/composables/useNotice'
import ButtonUI from '@/components/ui/ButtonUI.vue'

// The single notice surface, mounted once in App.vue beside the other hosts.
//
// Bottom-centre, matching AgentLockHost's floating card, because it is the one
// spot that collides with neither the Insert dock (bottom-left) nor the
// Edit/Play toggle (bottom-right).
//
// z-115 puts it above TooltipHost's 110, the previous ceiling. An error a
// tooltip can cover is an error nobody reads, and this is the one surface that
// must stay visible while a modal is open — a save failing DURING a publish
// dialog is exactly when it matters.
//
// Escape is deliberately not wired: ModalStackHost owns the one Escape
// listener, and a notice must not compete for it.

const { notices, dismiss } = useNotice()
</script>

<template>
  <!-- the first aria-live region in the editor: a save failure was previously
       announced to a screen reader not at all -->
  <div
    class="pointer-events-none fixed bottom-8 left-1/2 z-115 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4"
    role="region"
    aria-label="Notifications"
    aria-live="assertive"
    aria-atomic="false"
  >
    <div
      v-for="notice in notices"
      :key="notice.id"
      :role="notice.kind === 'error' ? 'alert' : 'status'"
      class="pointer-events-auto flex items-start gap-3 rounded-3xl bg-background p-4 shadow-xl"
      :class="notice.kind === 'error' ? 'text-danger' : 'text-pending'"
    >
      <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="notice.kind === 'error' ? 'bg-danger' : 'bg-pending'" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">{{ notice.title }}</p>
        <p v-if="notice.detail" class="mt-0.5 text-xs break-words text-muted-foreground">
          {{ notice.detail }}
        </p>
      </div>
      <ButtonUI
        v-if="notice.action"
        size="sm"
        variant="outline"
        @click="notice.action.run()"
      >
        {{ notice.action.label }}
      </ButtonUI>
      <ButtonUI
        variant="icon"
        :icon="X"
        tooltip="Dismiss"
        @click="dismiss(notice.id)"
      />
    </div>
  </div>
</template>
