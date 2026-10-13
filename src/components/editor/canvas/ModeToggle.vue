<script setup lang="ts">
import { Moon, Pencil, Play, Sun } from 'lucide-vue-next'
import { useViewMode } from '@/composables/useViewMode'
import { closePalette } from '@/composables/useCommandPalette'
import { useColorMode } from '@/composables/useColorMode'

const { isBuild, setMode } = useViewMode()

// The canvas's colour mode, NOT the editor chrome's (that is useTheme, in the
// account settings). It sits here because it is a way of looking at the PAGE,
// like Edit/Play — and because a dark palette you cannot see on the canvas is
// one you can only check by publishing. Shown only for a project that has
// something to switch: a dark token value, or a non-light site default.
const { mode: colorMode, used: colorModeUsed, toggle: toggleColorMode } = useColorMode()

function pick(next: 'build' | 'preview') {
  if (next === 'preview' && isBuild.value) closePalette()
  setMode(next)
}
</script>

<template>

  <div
    role="group"
    aria-label="Mode"
    class="flex h-10 items-center divide-x divide-input overflow-hidden rounded-full border border-input bg-background shadow-lg"
    @click.stop
  >
    <button
      v-tooltip="'Edit'"
      type="button"
      aria-label="Edit"
      :aria-pressed="isBuild"
      class="flex h-full w-10 items-center justify-center transition-colors outline-none focus-visible:bg-accent/30"
      :class="
        isBuild
          ? 'bg-accent/30 text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground'
      "
      @click="pick('build')"
    >
      <Pencil class="size-4" />
    </button>
    <button
      v-tooltip="'Play'"
      type="button"
      aria-label="Play"
      :aria-pressed="!isBuild"
      class="flex h-full w-10 items-center justify-center transition-colors outline-none focus-visible:bg-accent/30"
      :class="
        !isBuild
          ? 'bg-accent/30 text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/30 hover:text-accent-foreground'
      "
      @click="pick('preview')"
    >
      <Play class="size-4" />
    </button>
    <button
      v-if="colorModeUsed"
      v-tooltip="colorMode === 'dark' ? 'Light mode' : 'Dark mode'"
      type="button"
      :aria-label="colorMode === 'dark' ? 'Light mode' : 'Dark mode'"
      :aria-pressed="colorMode === 'dark'"
      class="flex h-full w-10 items-center justify-center text-muted-foreground transition-colors outline-none hover:bg-accent/30 hover:text-accent-foreground focus-visible:bg-accent/30"
      @click="toggleColorMode()"
    >
      <Sun v-if="colorMode === 'dark'" class="size-4" />
      <Moon v-else class="size-4" />
    </button>
  </div>
</template>
