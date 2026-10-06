<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    step?: number
  }>(),
  { min: 0, max: 100, step: 1 },
)

const model = defineModel<number>({ default: 0 })

/** filled portion of the track, 0–100% */
const percent = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return ((model.value - props.min) / span) * 100
})
</script>

<template>
  <input
    :value="model"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    class="slider"
    :style="{
      background: `linear-gradient(to right, var(--foreground) ${percent}%, var(--muted) ${percent}%)`,
    }"
    @input="model = Number(($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 3px;
  border-radius: 9999px;
  cursor: pointer;
  outline: none;
}

/* the ring of background around the thumb keeps it legible against both the
   filled and unfilled halves of the track, in either theme */
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: var(--foreground);
  border: 2px solid var(--background);
  box-shadow: 0 0 0 1px var(--muted);
  transition: transform 0.1s ease;
}

.slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: var(--foreground);
  border: 2px solid var(--background);
  box-shadow: 0 0 0 1px var(--muted);
  transition: transform 0.1s ease;
}

.slider:hover::-webkit-slider-thumb {
  transform: scale(1.15);
}
.slider:hover::-moz-range-thumb {
  transform: scale(1.15);
}

.slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px var(--accent);
}
.slider:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 2px var(--accent);
}
</style>
