import { computed, ref } from 'vue'
import { useElement } from './useElement'
import { useStructure } from './useStructure'
import type { InteractionBinding } from '@/types/editor'
import { deepClone } from '@/lib/tree'
import { uid } from '@/lib/shared/ids.js'

const menu = ref<{ x: number; y: number; targetId: string } | null>(null)

// class/interaction copies are node STATE, not structure, so they stay here;
// the element clipboard lives in useStructure with the ops that use it
const copiedClasses = ref<string | null>(null)
const copiedInteractions = ref<InteractionBinding[] | null>(null)
export function useContextMenu() {
  const { selectedElement, selectedElementIds, getElement, selectElement } = useElement()
  const { backend, clipboard } = useStructure()
  const copiedBlock = clipboard

  const target = computed(() => (menu.value ? getElement(menu.value.targetId) : null))
  const targetIsBody = computed(() => target.value?.type === 'body')

  // --- keyboard-driven actions operate on the current selection ---

  function copySelection() {
    backend.value.copy(selectedElementIds.value)
  }

  function pasteOnSelection() {
    const el = selectedElement.value
    if (el) backend.value.paste(el.id)
  }

  function duplicateSelection() {
    backend.value.duplicate(selectedElementIds.value)
  }

  function deleteSelection() {
    backend.value.remove(selectedElementIds.value)
  }

  function wrapSelection() {
    backend.value.wrap(selectedElementIds.value)
  }

  function cutSelection() {
    copySelection()
    deleteSelection()
  }

  function openMenu(e: MouseEvent, targetId: string) {
    e.preventDefault()
    // right-clicking inside a multi-selection keeps it, so a menu action can
    // operate on the whole group; otherwise collapse to the clicked element
    if (!selectedElementIds.value.includes(targetId)) selectElement(targetId)
    menu.value = { x: e.clientX, y: e.clientY, targetId }
  }

  function closeMenu() {
    menu.value = null
  }

  function duplicate() {
    if (menu.value) backend.value.duplicate([menu.value.targetId])
  }

  function copy() {
    if (menu.value) backend.value.copy([menu.value.targetId])
  }

  function paste() {
    if (menu.value) backend.value.paste(menu.value.targetId)
  }

  function remove() {
    if (menu.value) backend.value.remove([menu.value.targetId])
  }

  function copyClasses() {
    if (target.value) copiedClasses.value = target.value.classes ?? ''
  }

  function pasteClasses() {
    if (target.value && copiedClasses.value !== null) target.value.classes = copiedClasses.value
  }

  function copyInteractions() {
    if (target.value) {
      copiedInteractions.value = deepClone(target.value.interactions ?? [])
    }
  }

  function pasteInteractions() {
    if (target.value && copiedInteractions.value) {
      // fresh ids so the pasted set never collides with the source's
      target.value.interactions = copiedInteractions.value.map((i) => ({
        ...i,
        id: uid(),
      }))
    }
  }

  return {
    menu,
    target,
    targetIsBody,
    copiedBlock,
    copiedClasses,
    copiedInteractions,
    openMenu,
    closeMenu,
    duplicate,
    copy,
    paste,
    remove,
    copyClasses,
    pasteClasses,
    copyInteractions,
    pasteInteractions,
    copySelection,
    cutSelection,
    pasteOnSelection,
    duplicateSelection,
    deleteSelection,
    wrapSelection,
  }
}
