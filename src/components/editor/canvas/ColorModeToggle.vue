<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useColorMode } from '@/composables/useColorMode'

const { mode, used, toggle } = useColorMode()
</script>

<template>
  <button
    v-if="used"
    v-tooltip="mode === 'dark' ? 'Light mode' : 'Dark mode'"
    type="button"
    :aria-label="mode === 'dark' ? 'Light mode' : 'Dark mode'"
    :aria-pressed="mode === 'dark'"
    class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-input bg-background text-muted-foreground shadow-lg transition-colors outline-none hover:bg-accent/30 hover:text-accent-foreground focus-visible:bg-accent/30"
    @click.stop="toggle()"
  >
    <Sun v-if="mode === 'dark'" class="size-4" />
    <Moon v-else class="size-4" />
  </button>
</template>
