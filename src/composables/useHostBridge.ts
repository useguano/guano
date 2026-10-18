import { watch } from 'vue'
import { hostBridge, installHostCallbacks } from '@/lib/hostBridge'
import { usePersistence } from './usePersistence'
import { usePublishDialog } from './usePublishDialog'

let started = false

export function useHostBridge() {
  function start() {
    if (started || !hostBridge.available) return
    started = true
    const { status } = usePersistence()
    const { openPublish } = usePublishDialog()
    installHostCallbacks(openPublish)
    watch(status, (value) => hostBridge.post({ type: 'save-status', status: value }), {
      immediate: true,
    })
  }

  return { start }
}
