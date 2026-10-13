<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useColorMode } from '@/composables/useColorMode'

/**
 * The canvas's colour mode — the PROJECT's light/dark, not the editor chrome's
 * (that is `useTheme`, in account settings). Shown only for a project that has
 * something to switch: a dark token value, or a non-light site default.
 *
 * `standalone` wears the pill itself, which is what the components board needs:
 * the board has nothing to play, so there is no Edit/Play group for this to sit
 * inside — but a component's dark variation still has to be visible somewhere,
 * and the board is where a component is styled.
 */
defineProps<{ standalone?: boolean }>()

const { mode, used, toggle } = useColorMode()
</script>

<template>
  <button
    v-if="used"
    v-tooltip="mode === 'dark' ? 'Light mode' : 'Dark mode'"
    type="button"
    :aria-label="mode === 'dark' ? 'Light mode' : 'Dark mode'"
    :aria-pressed="mode === 'dark'"
    class="flex w-10 items-center justify-center text-muted-foreground transition-colors outline-none hover:bg-accent/30 hover:text-accent-foreground focus-visible:bg-accent/30"
    :class="
      standalone
        ? 'h-10 overflow-hidden rounded-full border border-input bg-background shadow-lg'
        : 'h-full'
    "
    @click.stop="toggle()"
  >
    <Sun v-if="mode === 'dark'" class="size-4" />
    <Moon v-else class="size-4" />
  </button>
</template>
