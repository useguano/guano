<script setup lang="ts">
// Flat section for the project settings modal: title + one-line description,
// a hairline, then the fields. No card — the panel separates sections with
// spacing instead, so a settings page reads as one column rather than a stack
// of boxes. `danger` marks destructive groups; `action` is a header-right slot.
defineProps<{
  title: string
  description?: string
  danger?: boolean
}>()
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-col gap-2">
      <div class="flex items-start gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 class="text-xs font-medium" :class="danger ? 'text-danger' : 'text-foreground'">
            {{ title }}
          </h3>
          <p v-if="description" class="text-[10px] text-muted-foreground">{{ description }}</p>
        </div>
        <slot name="action" />
      </div>
      <div class="h-px" :class="danger ? 'bg-danger/40' : 'bg-input'" />
    </div>
    <slot />
  </section>
</template>
