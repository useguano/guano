import { watch } from 'vue'
import { hostBridge, installHostCallbacks, type HostViewMode } from '@/lib/hostBridge'
import { activeBranchId, usePersistence } from './usePersistence'
import { usePublishDialog } from './usePublishDialog'
import { agentTargetPosted, postAgentTarget, useAgentChat } from './useAgentChat'
import { useViewMode } from './useViewMode'
import { closePalette } from './useCommandPalette'

let started = false

/**
 * The page's half of the host bridge.
 *
 * `agent-target` is posted IMMEDIATELY, so it follows `agent-start` in the
 * same tick: the host waits for it rather than defaulting to Main. It is
 * posted again on every `ready` that has not seen one — a reload replays
 * `agent-start`, and the host dropped what it knew with the page that told
 * it. Keyed on `readyTick` rather than the status, which a `ready` does not
 * always move. → docs/agent-panel.md, The target follows the branch
 *
 * `view-mode` is the Edit / Play switch, which lives in the host's header and
 * not in the editor: the page posts the mode it is in and the host calls
 * `setViewMode` back. Leaving Edit closes the ⌘E palette here, not in
 * `useViewMode`, so the view-mode singleton never pulls in `useStructure`.
 */

export function useHostBridge() {
  function start() {
    if (started || !hostBridge.available) return
    started = true
    const { status } = usePersistence()
    const { openPublish } = usePublishDialog()
    const { ingest, exit, start: startAgent, readyTick } = useAgentChat()
    const { mode, isBuild, setMode } = useViewMode()
    function setViewMode(next: HostViewMode) {
      if (next !== 'build' && next !== 'preview') return
      if (next === 'preview' && isBuild.value) closePalette()
      setMode(next)
    }
    installHostCallbacks({ openPublish, setViewMode, agentEvent: ingest, agentExit: exit })
    startAgent()
    watch(activeBranchId, (id) => postAgentTarget(id), { immediate: true })
    watch(readyTick, () => {
      if (!agentTargetPosted()) postAgentTarget(activeBranchId.value)
    })
    watch(status, (value) => hostBridge.post({ type: 'save-status', status: value }), {
      immediate: true,
    })
    watch(mode, (value) => hostBridge.post({ type: 'view-mode', mode: value }), {
      immediate: true,
    })
  }

  return { start }
}
