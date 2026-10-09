import { computed, effectScope, ref, watch } from 'vue'
import { useProject } from './useProject'
import { migrateStoredProject, readStoredProject } from '@/lib/storage'
import {
  ackedSeq,
  pendingWrites,
  storeAck,
  storeError,
  storeGet,
  storeGetFresh,
  storeSet,
} from '@/lib/store'
import { computeMerge } from '@/lib/merge'
import type { Project } from '@/types/editor'

export type SaveStatus = 'saved' | 'pending' | 'error'

export const SAVE_STATES: Record<
  SaveStatus,
  { class: string; dot: string; short: string; label: string }
> = {
  saved: { class: 'bg-success/10 text-success', dot: 'bg-success', short: 'Saved', label: 'All changes saved' },
  pending: { class: 'bg-pending/10 text-pending', dot: 'bg-pending', short: 'Saving…', label: 'Saving…' },
  error: { class: 'bg-danger/10 text-danger', dot: 'bg-danger', short: 'Save failed', label: 'Save failed — click to retry' },
}

const DEBOUNCE_MS = 500
const HISTORY_LIMIT = 50

export const MAIN_ID = 'main'

export const BRANCHES_META_KEY = 'guano-branches'

export const activeBranchId = ref(MAIN_ID)

export const autosaveSuspended = ref(false)

export function projectStorageKey(branchId: string) {
  return `guano-project:${branchId}`
}

const typing = ref(false)
const status = computed<SaveStatus>(() =>
  storeError.value ? 'error' : typing.value || pendingWrites.value > 0 ? 'pending' : 'saved',
)

const history = ref<string[]>([])
const pointer = ref(0)

export const currentSnapshot = computed(() => history.value[pointer.value] ?? '')

let timer: ReturnType<typeof setTimeout> | null = null
let restoring = false
let initialized = false

let baseline: { key: string; snapshot: string } | null = null

let pendingBaseline: { key: string; snapshot: string; seq: number } | null = null

const baselineFor = (key: string) => (baseline?.key === key ? baseline.snapshot : null)

let writeGen = 0

effectScope(true).run(() => {
  watch(storeAck, () => {
    const p = pendingBaseline
    if (p && ackedSeq(p.key) >= p.seq) {
      baseline = { key: p.key, snapshot: p.snapshot }
      pendingBaseline = null
    }
  })
})

const hasUnsavedWork = computed(() => status.value !== 'saved')

export function usePersistence() {
  const { project, projectVersion } = useProject()

  const canUndo = computed(() => pointer.value > 0)
  const canRedo = computed(() => pointer.value < history.value.length - 1)

  function persist(snapshot: string, key = projectStorageKey(activeBranchId.value)) {
    const seq = storeSet(key, snapshot)
    pendingBaseline = { key, snapshot, seq }
    typing.value = false
  }

  async function persistMerged(
    snapshot: string,
    opts: { fromHistory?: boolean; key?: string; baseline?: string | null } = {},
  ): Promise<string> {
    const gen = ++writeGen
    const key = opts.key ?? projectStorageKey(activeBranchId.value)
    const base = opts.baseline !== undefined ? opts.baseline : baselineFor(key)

    if (autosaveSuspended.value && opts.fromHistory) {
      typing.value = false
      return snapshot
    }
    if (base === null || autosaveSuspended.value) {
      persist(snapshot, key)
      return snapshot
    }
    let storedRaw: string | null
    try {
      storedRaw = await storeGetFresh(key)
    } catch {
      persist(snapshot, key)
      return snapshot
    }
    if (storedRaw === null || storedRaw === base || storedRaw === pendingBaseline?.snapshot) {
      persist(snapshot, key)
      return snapshot
    }
    let merged: Project
    try {
      const theirs = migrateStoredProject(JSON.parse(storedRaw) as Project)
      if (!theirs) {
        persist(snapshot, key)
        return snapshot
      }
      const { merged: result } = computeMerge(
        JSON.parse(base) as Project,
        JSON.parse(snapshot) as Project,
        theirs,
      )
      merged = result
    } catch {
      persist(snapshot, key)
      return snapshot
    }
    const mergedSnapshot = JSON.stringify(merged)
    persist(mergedSnapshot, key)
    if (mergedSnapshot === snapshot) return mergedSnapshot
    if (gen !== writeGen) return mergedSnapshot
    restoring = true
    project.value = merged
    restoring = false
    if (opts.fromHistory) {
      const h = history.value.slice()
      h[pointer.value] = mergedSnapshot
      history.value = h
    } else {
      const next = history.value.slice(0, pointer.value + 1)
      next.push(mergedSnapshot)
      if (next.length > HISTORY_LIMIT) next.shift()
      history.value = next
      pointer.value = next.length - 1
    }
    return mergedSnapshot
  }

  function load() {
    try {
      const meta = storeGet(BRANCHES_META_KEY)
      if (meta) activeBranchId.value = (JSON.parse(meta).activeId as string) || MAIN_ID

      const stored = readStoredProject(projectStorageKey(activeBranchId.value))
      if (stored) {
        restoring = true
        project.value = stored
        restoring = false
        baseline = {
          key: projectStorageKey(activeBranchId.value),
          snapshot: JSON.stringify(stored),
        }
      } else {
        persist(JSON.stringify(project.value))
      }
    } catch {
    }
    history.value = [JSON.stringify(project.value)]
    pointer.value = 0
  }

  function adoptRemote(next: Project) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    writeGen++
    restoring = true
    project.value = next
    restoring = false
    const snapshot = JSON.stringify(next)
    history.value = [snapshot]
    pointer.value = 0
    baseline = { key: projectStorageKey(activeBranchId.value), snapshot }
    pendingBaseline = null
    typing.value = false
  }

  async function commitReplacement(next: Project, priorBaseline: string | null): Promise<string> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    restoring = true
    project.value = next
    restoring = false
    const snapshot = JSON.stringify(next)
    history.value = [snapshot]
    pointer.value = 0
    const key = projectStorageKey(activeBranchId.value)
    return persistMerged(snapshot, { key, baseline: priorBaseline })
  }

  function commit(): Promise<string> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const snapshot = JSON.stringify(project.value)
    if (snapshot === history.value[pointer.value]) {
      return persistMerged(snapshot)
    }
    const next = history.value.slice(0, pointer.value + 1)
    next.push(snapshot)
    if (next.length > HISTORY_LIMIT) next.shift()
    history.value = next
    pointer.value = next.length - 1
    return persistMerged(snapshot)
  }

  function saveNow(): Promise<string> {
    return commit()
  }

  function apply(snapshot: string) {
    restoring = true
    project.value = JSON.parse(snapshot) as Project
    restoring = false
    typing.value = false
    void persistMerged(snapshot, { fromHistory: true })
  }

  function undo() {
    if (timer) commit()
    if (!canUndo.value) return
    pointer.value--
    apply(history.value[pointer.value]!)
  }

  function redo() {
    if (!canRedo.value) return
    pointer.value++
    apply(history.value[pointer.value]!)
  }

  function init() {
    if (initialized) return
    initialized = true
    load()
    watch(projectVersion, () => {
      if (restoring || autosaveSuspended.value) return
      typing.value = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(commit, DEBOUNCE_MS)
    })
  }

  return {
    status,
    hasUnsavedWork,
    canUndo,
    canRedo,
    init,
    saveNow,
    undo,
    redo,
    adoptRemote,
    commitReplacement,
  }
}
