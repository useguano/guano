<script setup lang="ts">
// The one way the app says "working on it".
//
// Inline (the default): a spinner with an optional word, for a row inside a
// modal or a form. `page`: a screen with nothing else to show yet (editor
// boot, the invite check) — the logo lands in the middle, then floats on a
// soft glow until the screen behind it is ready. Both motions are
// `motion-safe`, so a reduced-motion visitor gets the logo standing still.
import { LoaderCircle } from 'lucide-vue-next'
import MainLogo from '@/assets/MainLogo.vue'

withDefaults(
  defineProps<{
    label?: string
    size?: 'sm' | 'default' | 'lg'
    page?: boolean
  }>(),
  { label: '', size: 'default', page: false },
)

const SIZES = { sm: 'size-3.5', default: 'size-4', lg: 'size-6' }
</script>

<template>
  <div
    v-if="page"
    role="status"
    :aria-label="label || 'Loading'"
    class="flex min-h-screen flex-col items-center justify-center gap-6 bg-background"
  >
    <div class="relative flex items-center justify-center">
      <!-- the glow: breathes under the logo, in the logo's own colour -->
      <div
        class="absolute size-40 rounded-full bg-foreground/15 blur-3xl motion-safe:animate-glow"
      />
      <div class="motion-safe:animate-land">
        <MainLogo class="size-24 text-foreground motion-safe:animate-float" />
      </div>
    </div>
    <p v-if="label" class="text-xs text-muted-foreground motion-safe:animate-rise">{{ label }}</p>
  </div>

  <div
    v-else
    role="status"
    :aria-label="label || 'Loading'"
    class="flex items-center justify-center gap-2 text-muted-foreground"
  >
    <LoaderCircle class="shrink-0 animate-spin" :class="SIZES[size]" />
    <p v-if="label" class="text-xs">{{ label }}</p>
  </div>
</template>
