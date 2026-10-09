<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { MODAL_LABEL } from './labelKey'

type Size = 'sm' | 'default' | 'lg' | 'xl' | 'full'

const props = withDefaults(
  defineProps<{
    size?: Size

    labelledBy?: string
    role?: 'dialog' | 'alertdialog'
  }>(),
  { size: 'default', role: 'dialog' },
)

const emit = defineEmits<{
  close: []
}>()

const sizes: Record<Size, string> = {
  sm: 'w-80',
  default: 'w-[28rem]',
  lg: 'w-[40rem]',
  xl: 'w-[840px] h-[660px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
  full: 'w-[min(92vw,1200px)] h-[88vh]',
}

const panel = ref<HTMLElement | null>(null)

const headerLabelId = ref<string | undefined>()
provide(MODAL_LABEL, (id: string) => (headerLabelId.value = id))

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

const focusable = () =>
  Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault()
  if (e.key !== 'Tab') return
  const items = focusable()
  if (!items.length) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || !panel.value?.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

let returnTo: HTMLElement | null = null
onMounted(() => {
  returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (!panel.value?.contains(document.activeElement)) {
    const items = focusable()
    ;(items[0] ?? panel.value)?.focus()
  }
})
onBeforeUnmount(() => {
  if (returnTo?.isConnected) returnTo.focus()
})
</script>

<template>
  <div
    class="fixed inset-0 z-100 flex items-center justify-center bg-accent/25 backdrop-blur-sm"
    @click.self="$emit('close')"
  >
    <div
      ref="panel"
      :role="role"
      aria-modal="true"
      :aria-labelledby="labelledBy ?? headerLabelId"
      tabindex="-1"
      class="modal-panel rounded-2xl bg-background shadow-lg outline-none"
      :class="[
        sizes[size],
        size === 'xl' || size === 'full' ? 'overflow-auto' : 'max-h-[85vh] overflow-y-auto',
      ]"
      @keydown="onKeydown"
    >
      <slot />
    </div>
  </div>
</template>

<style>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition:
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: scale(0.96) translateY(6px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal-panel,
  .modal-leave-active .modal-panel {
    transition: none;
  }
}
</style>
