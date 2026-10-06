import { ref } from 'vue'

/**
 * Which rows are collapsed, by node id.
 *
 * Module-level because the drawer showing the tree unmounts whenever another column
 * takes the shared track, and the tree should come back as it was left.
 * Deliberately NOT stored on the node: a component master's tree is compared
 * by `JSON.stringify` to decide whether a library preview has been edited, so
 * parking view state on it would copy the component into the project just for
 * collapsing a row.
 */
const collapsed = ref(new Set<string>())

/** the row whose ref is being renamed inline, if any */
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

  /** open every ancestor of a node so its row is visible */
  function reveal(path: string[]) {
    if (!path.length) return
    const next = new Set(collapsed.value)
    for (const id of path) next.delete(id)
    collapsed.value = next
  }

  return { collapsed, isCollapsed, toggle, setCollapsed, reveal, editingRefId }
}
