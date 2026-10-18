import { useKeymap } from './useShortcut'
import { useContextMenu } from './useContextMenu'
import { usePersistence } from './usePersistence'
import { useStructure } from './useStructure'
import { togglePalette } from './useCommandPalette'
import { useAgentChat } from './useAgentChat'
import { useEffectsDrawer } from './useEffectsDrawer'
import { usePublishDialog } from './usePublishDialog'
import { useViewMode } from './useViewMode'
import { useAuth } from './useAuth'

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
  const { openPublish } = usePublishDialog()
  const { isBuild, toggleAgent } = useViewMode()
  const { toggleDrawer } = useEffectsDrawer()
  const { canBuild } = useAuth()
  const { answered: agentAnswered } = useAgentChat()

  const buildOnly = (fn: () => void) => () => {
    if (isBuild.value) fn()
  }

  const structural = (fn: () => void) => () => {
    if (canBuild.value) fn()
  }

  useKeymap([
    { key: 'c', mod: true, handler: structural(copySelection) },
    { key: 'x', mod: true, handler: structural(cutSelection) },
    { key: 'v', mod: true, handler: structural(pasteOnSelection) },
    { key: 'd', mod: true, shift: false, handler: structural(duplicateSelection) },
    { key: 'g', mod: true, handler: structural(wrapSelection) },
    { key: ['backspace', 'delete'], handler: structural(deleteSelection) },
    { key: 'arrowup', shift: true, mod: false, handler: structural(() => backend.value.nudge('up')) },
    { key: 'arrowdown', shift: true, mod: false, handler: structural(() => backend.value.nudge('down')) },
    { key: 'z', mod: true, shift: false, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    { key: 's', mod: true, shift: false, allowInInput: true, handler: saveNow },
    { key: 'e', mod: true, shift: false, allowInInput: true, handler: buildOnly(togglePalette) },
    { key: 'e', mod: true, shift: true, allowInInput: true, handler: buildOnly(toggleDrawer) },
    { key: 'p', mod: true, shift: false, allowInInput: true, handler: openPublish },
    {
      key: 'j',
      mod: true,
      shift: false,
      allowInInput: true,
      handler: () => {
        if (agentAnswered.value) toggleAgent()
      },
    },
  ])
}
