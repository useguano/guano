<script setup lang="ts">
/**
 * A group of DrawerFields. The heading is the same micro-label the drawer's
 * list view uses for "Pages" / "Collections", so navigating and editing read as
 * one surface rather than two products.
 *
 * Deliberately not SettingsGroup: that one carries a title, a full-sentence
 * description and a hairline, which is right in the wide settings modal and
 * five times too much furniture in a 16rem column. Here whitespace separates
 * sections, and anything that survived from the descriptions is a field `hint`.
 */
defineProps<{ title: string }>()
</script>

<template>
  <section class="flex flex-col gap-2">
    <div class="flex items-center gap-1">
      <h3 class="min-w-0 flex-1 truncate section-label">
        {{ title }}
      </h3>
      <slot name="action" />
    </div>
    <div class="flex flex-col gap-2.5">
      <slot />
    </div>
  </section>
</template>
