<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { computeFloatingPosition } from '@/lib/floating'

const props = withDefaults(
  defineProps<{
    icon?: Component

    label?: string
    align?: 'left' | 'right'
    side?: 'top' | 'bottom'
    width?: string
    triggerClass?: string
    disabled?: boolean
  }>(),
  {
    align: 'right',
    side: 'bottom',
    width: 'w-44',
    triggerClass:
      'flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent',
    disabled: false,
  },
)

const triggerIcon = props.icon ?? MoreHorizontal

const open = ref(false)
const root = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const pos = ref({ left: 0, top: 0 })

async function place() {
  await nextTick()
  if (!root.value || !panel.value) return
  const anchor = root.value.getBoundingClientRect()
  const { width, height } = panel.value.getBoundingClientRect()
  const p = computeFloatingPosition(anchor, { width, height }, {
    placement: `${props.side}-${props.align === 'left' ? 'start' : 'end'}`,
    offset: 4,
  })
  pos.value = { left: p.left, top: p.top }
}

function toggle() {
  open.value = !open.value
  if (open.value) place()
}
function close() {
  open.value = false
}

function onClickOutside(e: MouseEvent) {
  const t = e.target as Node
  if (root.value?.contains(t) || panel.value?.contains(t)) return
  close()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    close()
  }
}
onMounted(() => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div ref="root" :data-open="open || undefined" class="relative shrink-0">
    <button
      type="button"
      :class="triggerClass"
      :aria-label="label"
      :disabled="disabled"
      @click="toggle"
    >
      <slot name="trigger">
        <component :is="triggerIcon" class="size-3.5" />
      </slot>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="fixed z-105 flex flex-col rounded-xl border border-input bg-background p-1 shadow-lg"
        :class="width"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      >
        <slot :close="close" />
      </div>
    </Teleport>
  </div>
</template>
