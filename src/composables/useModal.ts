import { ref, markRaw, type Component } from 'vue'
import ConfirmModal from '@/components/modal/ConfirmModal.vue'

export interface ModalEntry {
  id: number
  component: Component
  props?: Record<string, unknown>
  resolve: (result: unknown) => void
}

const stack = ref<ModalEntry[]>([])

let nextId = 1

export function useModal() {
  function openModal<T = unknown>(component: Component, props?: Record<string, unknown>): Promise<T | null> {
    return new Promise((resolve) => {
      stack.value = [
        ...stack.value,
        {
          id: nextId++,
          component: markRaw(component),
          props,
          resolve: (r) => resolve((r ?? null) as T | null),
        },
      ]
    })
  }

  function closeTop(result?: unknown) {
    const top = stack.value.at(-1)
    if (!top) return
    stack.value = stack.value.slice(0, -1)
    top.resolve(result)
  }

  async function confirm(opts: { title: string; message: string; confirmLabel?: string }): Promise<boolean> {
    return (await openModal<boolean>(ConfirmModal, opts)) === true
  }

  return { stack, openModal, closeTop, confirm }
}
