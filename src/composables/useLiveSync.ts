import { computed, ref } from 'vue'
import {
  usePersistence,
  activeBranchId,
  autosaveSuspended,
  projectStorageKey,
} from './usePersistence'
import { rehydrateStore } from '@/lib/store'
import { readStoredProject } from '@/lib/storage'

const QUIET_MS = 10_000
const APPLY_DEBOUNCE_MS = 250

const agentActive = ref(false)
const overrideLock = ref(false)
const writeCount = ref(0)

export const agentLocked = computed(() => agentActive.value && !overrideLock.value)
export const agentWriteCount = writeCount

let source: EventSource | null = null
let quietTimer: ReturnType<typeof setTimeout> | null = null
let applyTimer: ReturnType<typeof setTimeout> | null = null
let weSuspendedAutosave = false

export function useLiveSync() {
  const { adoptRemote } = usePersistence()

  async function applyRemote(key: string) {
    try {
      await rehydrateStore([key])
      const stored = readStoredProject(key)
      if (stored) adoptRemote(stored)
    } catch {
    }
  }

  function endSession() {
    agentActive.value = false
    overrideLock.value = false
    writeCount.value = 0
    if (weSuspendedAutosave) {
      autosaveSuspended.value = false
      weSuspendedAutosave = false
    }
  }

  function onAgentWrite(key: string) {
    writeCount.value++
    agentActive.value = true
    if (!overrideLock.value && !autosaveSuspended.value) {
      autosaveSuspended.value = true
      weSuspendedAutosave = true
    }
    if (quietTimer) clearTimeout(quietTimer)
    quietTimer = setTimeout(endSession, QUIET_MS)
    if (applyTimer) clearTimeout(applyTimer)
    applyTimer = setTimeout(() => void applyRemote(key), APPLY_DEBOUNCE_MS)
  }

  function start() {
    if (source) return
    source = new EventSource('/api/events')
    source.onmessage = (message) => {
      let event: { type?: string; key?: string; source?: string }
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      if (event.type !== 'store-write' || event.source !== 'agent') return
      if (event.key !== projectStorageKey(activeBranchId.value)) return
      onAgentWrite(event.key)
    }
  }

  function takeOver() {
    overrideLock.value = true
    if (weSuspendedAutosave) {
      autosaveSuspended.value = false
      weSuspendedAutosave = false
    }
  }

  return { start, takeOver, agentLocked, agentActive, writeCount }
}
