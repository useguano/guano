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

/** presentation metadata for each SaveStatus (the header's save pill) */
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

/** the always-present trunk branch. Defined here rather than in useBranches
 * for the same reason activeBranchId is — everything storage-keyed needs it,
 * and useBranches already depends on this module. Re-exported from
 * useBranches, which is where callers read it from. */
export const MAIN_ID = 'main'

/** the branch-list + activeId blob (which branch to resume) */
export const BRANCHES_META_KEY = 'guano-branches'

/**
 * Branch whose project is loaded; lives here (not in useBranches) so
 * storage stays branch-keyed without a circular import.
 */
export const activeBranchId = ref(MAIN_ID)

/** While true the deep autosave watcher is a no-op. The AI assistant sets this
 * around a run: the store is latest-wins, so a debounced autosave of the stale
 * in-memory project would clobber the agent's server-side writes mid-run. */
export const autosaveSuspended = ref(false)

export function projectStorageKey(branchId: string) {
  return `guano-project:${branchId}`
}

// 'saved' means server-acked: the store's queue is empty and error-free
const typing = ref(false)
const status = computed<SaveStatus>(() =>
  storeError.value ? 'error' : typing.value || pendingWrites.value > 0 ? 'pending' : 'saved',
)

// whole-project JSON snapshots; pointer marks the current state
const history = ref<string[]>([])
const pointer = ref(0)

/** the last committed whole-project snapshot — reused for cheap dirty
 * checks (e.g. hasUnpublishedChanges) so nothing else has to re-stringify
 * the image-heavy project on every edit */
export const currentSnapshot = computed(() => history.value[pointer.value] ?? '')

let timer: ReturnType<typeof setTimeout> | null = null
let restoring = false
let initialized = false

/**
 * The project as this tab last knew the SERVER to hold — the common ancestor
 * for merge-on-save. The store is latest-wins on one whole-project blob, so
 * without this an open tab's autosave silently reverts anything another
 * writer (an MCP agent, another session) changed in the meantime: a deleted
 * animation would come back from the dead. With it, a save that finds the
 * stored blob changed merges per entity instead of overwriting.
 * null = no baseline yet (fresh boot / corrupt read) → plain write.
 *
 * TAGGED WITH ITS KEY, which is not bookkeeping. A branch switch moves
 * `activeBranchId` and then replaces the project, so an untagged baseline
 * could be carried from the branch you left into a merge against the branch
 * you opened.
 */
let baseline: { key: string; snapshot: string } | null = null

/**
 * Written, but not yet confirmed by the server.
 *
 * The baseline used to advance the instant a write was QUEUED, so an offline
 * save left every later merge resolving against an ancestor the server never
 * held. It is promoted only when the store reports that op accepted.
 */
let pendingBaseline: { key: string; snapshot: string; seq: number } | null = null

/** the baseline, but only when it belongs to `key` */
const baselineFor = (key: string) => (baseline?.key === key ? baseline.snapshot : null)

/**
 * Bumps on every write entry point. A call that resumes after a newer one
 * started skips its history and project adoption — the same latest-wins rule
 * the store's own queue applies to the bytes, applied to the undo stack.
 */
let writeGen = 0

// Detached: this is app-wide state, and a watcher created inside whichever
// component happened to call the composable first would die with it.
effectScope(true).run(() => {
  watch(storeAck, () => {
    const p = pendingBaseline
    if (p && ackedSeq(p.key) >= p.seq) {
      baseline = { key: p.key, snapshot: p.snapshot }
      pendingBaseline = null
    }
  })
})

/**
 * Is there work the server does not have yet?
 *
 * Derived from the same `status` the save pill shows — not a second piece of
 * state — because an unload guard that disagrees with the visible status is
 * worse than no guard at all.
 */
const hasUnsavedWork = computed(() => status.value !== 'saved')

export function usePersistence() {
  const { project, projectVersion } = useProject()

  const canUndo = computed(() => pointer.value > 0)
  const canRedo = computed(() => pointer.value < history.value.length - 1)

  /**
   * The single storage write — server-backed via the store adapter.
   *
   * `key` is explicit, and that fixes a live bug rather than tidying one.
   * `persistMerged` captures the key BEFORE its awaits while this read it
   * back AFTER them, so a save still in flight across a branch switch read
   * the right key and wrote the wrong one: the branch you had just opened was
   * overwritten with a merge of the branch you left.
   */
  function persist(snapshot: string, key = projectStorageKey(activeBranchId.value)) {
    const seq = storeSet(key, snapshot)
    pendingBaseline = { key, snapshot, seq }
    typing.value = false
  }

  /**
   * Writes an edit, merging first if the stored project moved under us.
   *
   * Three cases:
   *  - nothing changed server-side (the overwhelmingly common one) → plain write
   *  - we have no baseline, or an agent owns the project (live sync replaces
   *    wholesale), or the read fails → plain write, same as before
   *  - the blob changed → 3-way merge against the baseline. Our edits win any
   *    genuine conflict (the human is here and typing); entities only THEY
   *    touched — including deletions — survive.
   */
  async function persistMerged(
    snapshot: string,
    opts: { fromHistory?: boolean; key?: string; baseline?: string | null } = {},
  ): Promise<string> {
    const gen = ++writeGen
    const key = opts.key ?? projectStorageKey(activeBranchId.value)
    const base = opts.baseline !== undefined ? opts.baseline : baselineFor(key)

    // An agent owns the project while autosave is suspended, and the lock
    // overlay is what normally keeps a human out. An undo is still reachable
    // programmatically, and a plain write there would clobber the agent
    // mid-run — the one thing the flag exists to prevent — so it changes the
    // in-memory project and writes nothing at all.
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
      persist(snapshot, key) // offline / server hiccup — behave as before
      return snapshot
    }
    // `pendingBaseline` covers the round trip our own write is still in: for
    // that window the stored bytes differ from the confirmed baseline but are
    // ours, and merging against them would be work for nothing.
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
      persist(snapshot, key) // unparseable remote — our state is the better bet
      return snapshot
    }
    const mergedSnapshot = JSON.stringify(merged)
    persist(mergedSnapshot, key)
    if (mergedSnapshot === snapshot) return mergedSnapshot
    // a newer write started while this one was reading; its history is the
    // one that counts
    if (gen !== writeGen) return mergedSnapshot
    // adopt what we actually stored, so the editor shows the merged truth
    restoring = true
    project.value = merged
    restoring = false
    if (opts.fromHistory) {
      // Replace the slot the user navigated TO, rather than truncating and
      // pushing. `undo()` has already moved the pointer, so a push would
      // discard the whole redo arm: one ⌘Z against a busy agent left a state
      // that was neither the old nor the new one, and no ⌘⇧Z to get back.
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
      // resume the branch that was active last session
      // (the boot sequence hydrated these keys before init() runs)
      const meta = storeGet(BRANCHES_META_KEY)
      if (meta) activeBranchId.value = (JSON.parse(meta).activeId as string) || MAIN_ID

      const stored = readStoredProject(projectStorageKey(activeBranchId.value))
      if (stored) {
        restoring = true
        project.value = stored
        restoring = false
        // read straight off the server, so it IS what the server holds
        baseline = {
          key: projectStorageKey(activeBranchId.value),
          snapshot: JSON.stringify(stored),
        }
      } else {
        // fresh instance: persist the default project immediately, instead of
        // only on the first edit — otherwise the server has no project blob
        // and every out-of-band reader (the MCP agent surface) fails on Main
        persist(JSON.stringify(project.value))
      }
    } catch {
      // corrupt storage — start from the in-memory default project
    }
    history.value = [JSON.stringify(project.value)]
    pointer.value = 0
  }

  /**
   * Adopt a state that is ALREADY on the server: fresh undo history, no write.
   *
   * Used for the live agent sync and for opening a branch. Writing here would
   * race a concurrent agent save — our echo of the fetched blob could land
   * after a newer one and revert it, since the store is latest-wins — and for
   * a branch switch there is nothing to write anyway: these bytes came out of
   * that branch's own key a moment ago.
   */
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
    // this state came FROM the server, so it is the new common ancestor
    baseline = { key: projectStorageKey(activeBranchId.value), snapshot }
    pendingBaseline = null
    typing.value = false
  }

  /**
   * Replace the project with a state that exists NOWHERE yet, and write it.
   *
   * The merge-into-Main case: the result of a 3-way merge the user resolved in
   * a dialog, which Main has never held. It is merge-aware on purpose —
   * `priorBaseline` is the Main the merge was computed from, so a change that
   * landed on Main while the dialog was open is merged in rather than
   * overwritten. Returns the snapshot actually stored, which may differ.
   */
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

  /** snapshot the settled state into history and storage.
   * Returns the write, so a publish can await the save it just asked for
   * instead of racing it. */
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

  /**
   * Apply a history entry (undo/redo).
   *
   * Through the MERGE path, not a plain write. Undo wrote the whole blob with
   * no re-read, so one ⌘Z reverted everything another writer had changed since
   * this tab's baseline — while the save pill said Saved.
   */
  function apply(snapshot: string) {
    restoring = true
    project.value = JSON.parse(snapshot) as Project
    restoring = false
    typing.value = false
    void persistMerged(snapshot, { fromHistory: true })
  }

  function undo() {
    if (timer) commit() // fold un-settled keystrokes into history first
    if (!canUndo.value) return
    pointer.value--
    apply(history.value[pointer.value]!)
  }

  function redo() {
    if (!canRedo.value) return
    pointer.value++
    apply(history.value[pointer.value]!)
  }

  /** call once at app startup — undo/redo keys live in useEditorShortcuts */
  function init() {
    if (initialized) return
    initialized = true
    load()
    // projectVersion is useProject's single shared deep watcher — watching it
    // avoids a second whole-document traversal on every keystroke
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
