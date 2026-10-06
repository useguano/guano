<script setup lang="ts">
/**
 * One field in the Pages drawer: a micro-label stacked ABOVE a full-width
 * control, with an optional hint under it.
 *
 * Deliberately not RowUI. RowUI puts the label beside the control behind a
 * fixed 4.5rem gutter, which at the drawer's 16rem leaves ~8rem for the input —
 * too narrow for a slug, an SEO title or a select. Stacking is the only shape
 * that works at this width, so the drawer has its own field primitive and
 * RowUI keeps serving the wide surfaces (project settings, the right rail).
 *
 * The DOM shape — root div > (div > span.label) + control — is load-bearing:
 * e2e/ui-entry-editor.spec.ts finds a collection field's editor by walking it.
 */
defineProps<{
  label: string
  /** one short line under the control; use it for constraints, not prose */
  hint?: string
}>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-[10px] font-medium text-muted-foreground">
        {{ label }}
      </span>
      <slot name="end" />
    </div>
    <slot />
    <p v-if="hint" class="text-[10px] text-muted-foreground">{{ hint }}</p>
  </div>
</template>
