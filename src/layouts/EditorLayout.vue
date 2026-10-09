<script setup lang="ts">
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
