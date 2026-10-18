import { watch } from 'vue'
import { hostBridge, installHostCallbacks } from '@/lib/hostBridge'
import { activeBranchId, usePersistence } from './usePersistence'
import { usePublishDialog } from './usePublishDialog'
import { agentTargetPosted, postAgentTarget, useAgentChat } from './useAgentChat'

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
 */

export function useHostBridge() {
  function start() {
    if (started || !hostBridge.available) return
    started = true
    const { status } = usePersistence()
    const { openPublish } = usePublishDialog()
    const { ingest, exit, start: startAgent, readyTick } = useAgentChat()
    installHostCallbacks({ openPublish, agentEvent: ingest, agentExit: exit })
    startAgent()
    watch(activeBranchId, (id) => postAgentTarget(id), { immediate: true })
    watch(readyTick, () => {
      if (!agentTargetPosted()) postAgentTarget(activeBranchId.value)
    })
    watch(status, (value) => hostBridge.post({ type: 'save-status', status: value }), {
      immediate: true,
    })
  }

  return { start }
}
