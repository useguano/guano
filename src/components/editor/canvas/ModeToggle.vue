<script setup lang="ts">
// The Edit / Play switch: the shell's two surfaces are a mode of the page you
// are on, not a destination, so the control sits on the canvas itself — its
// bottom-RIGHT corner — rather than in the rail. The bottom-left corner is the
// InsertDock's: inserting is a thing you do to the canvas, switching mode is a
// thing you do to the whole surface, and they stay out of each other's way.
//
// Edit is `useViewMode`'s Build surface (breakpoint frames, layers, the full
// inspector), Play its Preview surface — the site rendered as one column,
// read-only, the way a visitor gets it (links, interactions and motion run for
// real; comments are the one thing you add). The internal names stay
// build/preview — this is the only place the UI vocabulary is spelled out.
//
// Purely presentational: every bit of state lives in `useViewMode`. BuildView
// decides whether it is mounted at all (never on the components board, never
// for a contributor, who is pinned to Play).
import { Pencil, Play } from 'lucide-vue-next'
import { useViewMode } from '@/composables/useViewMode'
import { closePalette } from '@/composables/useCommandPalette'

const { isBuild, setMode } = useViewMode()

/**
 * LEAVING Edit closes the ⌘E insert panel: it has no meaning in Play, and
 * leaving it open would spring it back the moment Edit returns. Clicking the
 * half that is already lit is not leaving anything, so it must not close the
 * panel someone is working in — hence the guard rather than a bare call.
 *
 * It closes HERE rather than in `useViewMode.setMode` — the palette pulls in
 * `useStructure`, and importing it from the view-mode singleton would tie the
 * shell's smallest composable to the whole structure layer.
 */
function pick(next: 'build' | 'preview') {
  if (next === 'preview' && isBuild.value) closePalette()
  setMode(next)
}
</script>

<template>
  <!-- like InsertDock, this floats INSIDE the surface it sits on, so its clicks
       must not reach what is underneath: the canvas deselects on a click in
       empty space, and Play's capture-phase handler drops a comment -->
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
