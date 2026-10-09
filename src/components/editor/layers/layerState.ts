import { ref } from 'vue'

const collapsed = ref(new Set<string>())

const editingRefId = ref<string | null>(null)

export function useLayerState() {
  const isCollapsed = (id: string) => collapsed.value.has(id)

  function toggle(id: string) {
    const next = new Set(collapsed.value)
    if (!next.delete(id)) next.add(id)
    collapsed.value = next
  }

  function setCollapsed(id: string, value: boolean) {
    if (value === isCollapsed(id)) return
    toggle(id)
  }

  function reveal(path: string[]) {
    if (!path.length) return
    const next = new Set(collapsed.value)
    for (const id of path) next.delete(id)
    collapsed.value = next
  }

  return { collapsed, isCollapsed, toggle, setCollapsed, reveal, editingRefId }
}
