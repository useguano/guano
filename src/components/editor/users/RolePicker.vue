<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next'
import MenuUI from '@/components/ui/MenuUI.vue'
import { ROLE_INFO, roleLabel } from '@/lib/roles'
import type { Role } from '@/composables/useAuth'

// A role dropdown that explains each option. Emits a change request rather than
// mutating directly, so the parent can confirm a sensitive demotion first.
const props = defineProps<{ role: Role; disabled?: boolean }>()
const emit = defineEmits<{ change: [role: Role] }>()

function pick(role: Role, close: () => void) {
  close()
  if (role !== props.role) emit('change', role)
}
</script>

<template>
  <MenuUI
    align="right"
    width="w-56"
    :disabled="disabled"
    trigger-class="flex h-7 items-center gap-1 rounded-lg bg-input px-2 text-xs outline-none hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 disabled:pointer-events-none"
  >
    <template #trigger>
      <span>{{ roleLabel(role) }}</span>
      <ChevronDown class="size-3 text-muted-foreground" />
    </template>
    <template #default="{ close }">
      <button
        v-for="r in ROLE_INFO"
        :key="r.value"
        type="button"
        class="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
        @click="pick(r.value, close)"
      >
        <Check class="mt-0.5 size-3 shrink-0" :class="r.value === role ? 'opacity-100' : 'opacity-0'" />
        <span class="flex flex-col">
          <span class="text-xs font-medium">{{ r.label }}</span>
          <span class="text-[10px] text-muted-foreground">{{ r.blurb }}</span>
        </span>
      </button>
    </template>
  </MenuUI>
</template>
