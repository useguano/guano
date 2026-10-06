<script setup lang="ts">
// The empty state of a settings list: the same bordered row the list draws
// for an item, with a hollow dot and a muted line, so an empty section keeps
// the shape of a filled one instead of collapsing to a sentence.
</script>

<template>
  <div class="flex flex-col rounded-xl border border-dashed border-input">
    <div class="flex items-center gap-2 px-3 py-2">
      <span class="size-1.5 shrink-0 rounded-full border border-muted-foreground/50" />
      <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground"><slot /></p>
    </div>
  </div>
</template>
