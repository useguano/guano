import { ref } from 'vue'

/**
 * The one place the editor can say something went wrong.
 *
 * There was none. A failed save showed as a colour on the save pill inside a
 * popover; a thrown render error showed as nothing at all, leaving a frozen
 * canvas and no way to tell a bug from a slow page. This is the singleton
 * behind NoticeHost, in the same shape as useTooltip / useModal / usePopover.
 */
export interface Notice {
  id: number
  kind: 'error' | 'warning'
  title: string
  detail?: string
  action?: { label: string; run: () => void }
  /**
   * Dedupe slot. A retrying save or a render loop can produce the same notice
   * many times a second; one with a `key` REPLACES the one that shares it
   * instead of stacking.
   */
  key?: string
}

const notices = ref<Notice[]>([])
const MAX = 3
let nextId = 1

export function useNotice() {
  function notify(notice: Omit<Notice, 'id'>) {
    const entry = { ...notice, id: nextId++ }
    const existing = notice.key ? notices.value.findIndex((n) => n.key === notice.key) : -1
    if (existing >= 0) {
      const next = notices.value.slice()
      next[existing] = entry
      notices.value = next
      return entry.id
    }
    notices.value = [...notices.value, entry].slice(-MAX)
    return entry.id
  }

  function dismiss(id: number) {
    notices.value = notices.value.filter((n) => n.id !== id)
  }

  /** drop whatever is showing under this key, if anything */
  function clearKey(key: string) {
    notices.value = notices.value.filter((n) => n.key !== key)
  }

  return { notices, notify, dismiss, clearKey }
}
