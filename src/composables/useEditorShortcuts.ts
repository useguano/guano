import { defineAsyncComponent } from 'vue'
import { useKeymap } from './useShortcut'
import { useContextMenu } from './useContextMenu'
import { usePersistence } from './usePersistence'
import { useStructure } from './useStructure'
import { togglePalette } from './useCommandPalette'
import { useEffectsDrawer } from './useEffectsDrawer'
import { useModal } from './useModal'
import { useViewMode } from './useViewMode'

// opened on demand, never on first paint — split out of the editor chunk
const PublishDialog = defineAsyncComponent(() => import('@/components/shared/PublishDialog.vue'))

/**
 * App-wide keyboard shortcuts (registered once from the editor view, which now
 * hosts both Build and Preview). Structural element actions only fire in Build
 * mode; undo/redo/save/publish work in both. Text fields keep their native
 * behaviour because the keymap skips inputs by default.
 */
export function useEditorShortcuts() {
  const {
    copySelection,
    cutSelection,
    pasteOnSelection,
    duplicateSelection,
    deleteSelection,
    wrapSelection,
  } = useContextMenu()
  const { backend } = useStructure()
  const { undo, redo, saveNow } = usePersistence()
  const { openModal, stack } = useModal()
  const { isBuild } = useViewMode()
  const { toggleDrawer } = useEffectsDrawer()

  // structural ops act on whatever the structure backend points at — the page,
  // or the component on the board — so they only need Build mode
  const buildOnly = (fn: () => void) => () => {
    if (isBuild.value) fn()
  }

  // ⌘P opens Publish (all roles — contributors can publish too) — dedupe so
  // holding it can't stack modals
  function openPublish() {
    if (stack.value.some((m) => m.component === PublishDialog)) return
    void openModal(PublishDialog)
  }

  useKeymap([
    // the element panels' keys (S / D / I) belong to the Layers tree, which
    // only answers them while it has focus — see useLayerSurface
    { key: 'c', mod: true, handler: buildOnly(copySelection) },
    { key: 'x', mod: true, handler: buildOnly(cutSelection) },
    { key: 'v', mod: true, handler: buildOnly(pasteOnSelection) },
    // shift: false so a stray ⌘⇧D (the removed data-panel shortcut) never duplicates
    { key: 'd', mod: true, shift: false, handler: buildOnly(duplicateSelection) },
    // ⌘G wraps the selection in a div
    { key: 'g', mod: true, handler: buildOnly(wrapSelection) },
    { key: ['backspace', 'delete'], handler: buildOnly(deleteSelection) },
    // Shift+↑/↓ moves the selection one visual slot — a re-parent without the
    // mouse. App-level rather than the tree's own, so it works from the canvas
    // too.
    { key: 'arrowup', shift: true, mod: false, handler: buildOnly(() => backend.value.nudge('up')) },
    { key: 'arrowdown', shift: true, mod: false, handler: buildOnly(() => backend.value.nudge('down')) },
    { key: 'z', mod: true, shift: false, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    // save works even from a focused field, so ⌘S never opens the browser dialog
    { key: 's', mod: true, shift: false, allowInInput: true, handler: saveNow },
    // ⌘E toggles the insert dock; allowInInput so it works from a focused field.
    // shift: false, or it would also answer the ⌘⇧E below — the first matching
    // binding wins and Shift is ignored when unset.
    { key: 'e', mod: true, shift: false, allowInInput: true, handler: buildOnly(togglePalette) },
    // ⌘⇧E toggles the effects drawer. A bare letter is not an option: S/D/I
    // only work because the Layers tree owns them while it has focus.
    { key: 'e', mod: true, shift: true, allowInInput: true, handler: buildOnly(toggleDrawer) },
    // ⌘P publishes; allowInInput so it overrides the browser print dialog everywhere
    { key: 'p', mod: true, shift: false, allowInInput: true, handler: openPublish },
  ])
}
