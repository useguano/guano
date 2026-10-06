<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTooltip } from '@/composables/useTooltip'
import { computeFloatingPosition } from '@/lib/floating'

const { active, hide } = useTooltip()

const labelEl = ref<HTMLElement>()
const style = ref<{ left: string; top: string; visibility: 'hidden' | 'visible' }>({
  left: '0px',
  top: '0px',
  visibility: 'hidden',
})

// render hidden → measure own size → position (flip/clamp) → reveal.
// Tooltips are transient (hover), so no continuous tracking loop; any scroll
// or resize just dismisses the tooltip instead of chasing the anchor.
watch(active, async (state) => {
  if (!state) return
  style.value = { left: '0px', top: '0px', visibility: 'hidden' }
  await nextTick()
  const label = labelEl.value
  if (!label || !active.value) return
  const { left, top } = computeFloatingPosition(
    state.el.getBoundingClientRect(),
    { width: label.offsetWidth, height: label.offsetHeight },
    { placement: state.side },
  )
  style.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
})

function dismiss() {
  if (active.value) hide(active.value.el)
}

onMounted(() => {
  window.addEventListener('scroll', dismiss, true)
  window.addEventListener('resize', dismiss)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', dismiss, true)
  window.removeEventListener('resize', dismiss)
})
</script>

<template>
  <!-- a stable id and role, so the trigger can point at this with
       aria-describedby: without them the label was drawn for sighted users
       and did not exist for anyone else -->
  <span
    v-if="active"
    id="guano-tooltip"
    ref="labelEl"
    role="tooltip"
    class="pointer-events-none fixed z-110 rounded-xl border border-input bg-background px-4 py-2 font-mono text-[10px] tracking-wider whitespace-nowrap"
    :style="style"
  >
    {{ active.text }}
  </span>
</template>
