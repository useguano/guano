<script setup lang="ts">
// `column` names which docked column holds the single 16rem track beside the
// rail — pages or components, or none for the bare canvas. One prop
// rather than three booleans so the rendered aside and the grid track can
// never disagree; `useViewMode` owns which one it is.
// `framed` gives the centre the Build canvas chrome (inset rounded card);
// full-site Preview wants a plain full-bleed pane.
//
// The column track is always in the grid, sized `auto`, and its aside is
// always rendered — it animates between 0 and 16rem wide, while an inner
// wrapper holds the full 16rem so the content clips instead of reflowing.
// Switching pages ↔ components swaps the content in place — same width,
// nothing to animate.
withDefaults(
  defineProps<{ column?: 'pages' | 'components' | null; framed?: boolean }>(),
  { column: null, framed: true },
)
</script>

<template>
  <div class="grid h-screen grid-cols-[auto_auto_1fr_auto] overflow-hidden">
    <aside>
      <slot name="rail" />
    </aside>

    <!-- always in the grid — a v-if here would drop a child and slide <main>
         into this track. The aside animates its width; the Transition keeps
         the leaving drawer's DOM up for as long as the track takes to close. -->
    <aside class="column min-h-0 overflow-hidden" :class="column ? 'w-64' : 'w-0'">
      <Transition name="column">
        <div v-if="column" class="h-full w-64 border-l border-input">
          <slot v-if="column === 'pages'" name="pages" />
          <slot v-else name="components" />
        </div>
      </Transition>
    </aside>

    <main
      class="overflow-y-auto"
      :class="framed ? 'bg-muted/25 rounded-lg my-2 border border-accent/50' : ''"
    >
      <slot />
    </main>

    <aside>
      <slot name="right" />
    </aside>
  </div>
</template>

<style scoped>
.column {
  transition: width 0.22s cubic-bezier(0.2, 0, 0, 1);
}
.column-enter-active,
.column-leave-active {
  transition: opacity 0.22s ease-out;
}
.column-enter-from,
.column-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .column,
  .column-enter-active,
  .column-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
