import { ref } from 'vue'

export interface Notice {
  id: number
  kind: 'error' | 'warning'
  title: string
  detail?: string
  action?: { label: string; run: () => void }

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

  function clearKey(key: string) {
    notices.value = notices.value.filter((n) => n.key !== key)
  }

  return { notices, notify, dismiss, clearKey }
}
