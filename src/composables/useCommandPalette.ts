import { ref } from 'vue'
import { useStructure } from './useStructure'

const open = ref(false)

export function closePalette() {
  open.value = false
}
export function togglePalette() {
  open.value = !open.value
}

export function useCommandPalette() {
  const { backend } = useStructure()

  const insertElement = (type: string, classes?: string) =>
    backend.value.insert({ kind: 'element', type, classes }, null, 'inside')
  const insertComponent = (name: string) => backend.value.insert({ kind: 'component', name }, null, 'inside')

  return { open, closePalette, togglePalette, insertElement, insertComponent }
}
