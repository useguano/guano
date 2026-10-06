import { ref } from 'vue'
import { useStructure } from './useStructure'

// runtime editor state: whether the ⌘E insert palette (the canvas dock) is open
const open = ref(false)

export function closePalette() {
  open.value = false
}
export function togglePalette() {
  open.value = !open.value
}

export function useCommandPalette() {
  const { backend } = useStructure()

  // insert at the current selection with smart position: the backend coerces
  // 'inside' → body appends / container last-child / leaf → after.
  const insertElement = (type: string, classes?: string) =>
    backend.value.insert({ kind: 'element', type, classes }, null, 'inside')
  const insertComponent = (name: string) => backend.value.insert({ kind: 'component', name }, null, 'inside')
  /** insert a library entry the project hasn't added yet: using it adds it */

  return { open, closePalette, togglePalette, insertElement, insertComponent }
}
