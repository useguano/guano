<script setup lang="ts">
import { Pencil, Play } from 'lucide-vue-next'
import { useViewMode } from '@/composables/useViewMode'
import { closePalette } from '@/composables/useCommandPalette'

const { isBuild, setMode } = useViewMode()

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
  </div>
</template>
