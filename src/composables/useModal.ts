import { ref, markRaw, type Component } from 'vue'
import ConfirmModal from '@/components/modal/ConfirmModal.vue'

export interface ModalEntry {
  id: number
  component: Component
  props?: Record<string, unknown>
  resolve: (result: unknown) => void
}

/**
 * App-level modal stack rendered by ModalStackHost (App.vue). Modals are
 * opened imperatively — no v-if at call sites. A modal component keeps its own
 * ModalHost/ModalDialog shell and emits `close` (optionally with a payload);
 * the host resolves the openModal promise with it. Escape lives in the host
 * and pops only the top entry.
 */
const stack = ref<ModalEntry[]>([])

let nextId = 1

export function useModal() {
  /** mount a modal component; resolves with the payload it emits on close (null if dismissed) */
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

  /** close the topmost modal, resolving its promise with `result` */
  function closeTop(result?: unknown) {
    const top = stack.value.at(-1)
    if (!top) return
    stack.value = stack.value.slice(0, -1)
    top.resolve(result)
  }

  /** promise-based destructive confirm — true only when the user confirmed */
  async function confirm(opts: { title: string; message: string; confirmLabel?: string }): Promise<boolean> {
    return (await openModal<boolean>(ConfirmModal, opts)) === true
  }

  return { stack, openModal, closeTop, confirm }
}
