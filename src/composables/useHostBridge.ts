import { watch } from 'vue'
import { hostBridge, installHostCallbacks } from '@/lib/hostBridge'
import { activeBranchId, usePersistence } from './usePersistence'
import { usePublishDialog } from './usePublishDialog'
import { agentTargetPosted, postAgentTarget, useAgentChat } from './useAgentChat'

let started = false

export function useHostBridge() {
  function start() {
    if (started || !hostBridge.available) return
    started = true
    const { status } = usePersistence()
    const { openPublish } = usePublishDialog()
    const { ingest, exit, start: startAgent, status: agentStatus } = useAgentChat()
    installHostCallbacks({ openPublish, agentEvent: ingest, agentExit: exit })
    startAgent()
    // The branch the editor has loaded, which the host turns into
    // `guano connect --target` and the agent never has to be asked about.
    // Immediate, because it has to follow `agent-start` in the same tick: the
    // host WAITS for it rather than defaulting to Main.
    watch(activeBranchId, (id) => postAgentTarget(id), { immediate: true })
    // A reload replays `agent-start`, and the target has to follow it — the
    // host clears what it knew with the page that told it.
    watch(agentStatus, (value) => {
      if (value !== 'unavailable' && value !== 'unknown' && !agentTargetPosted()) {
        postAgentTarget(activeBranchId.value)
      }
    })
    watch(status, (value) => hostBridge.post({ type: 'save-status', status: value }), {
      immediate: true,
    })
  }

  return { start }
}
