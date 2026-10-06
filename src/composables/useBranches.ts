import { computed, ref } from 'vue'
import { useAuth } from './useAuth'
import { useProject } from './useProject'
import {
  usePersistence,
  activeBranchId,
  projectStorageKey,
  BRANCHES_META_KEY,
  MAIN_ID,
} from './usePersistence'
import { computeMerge, applyResolutions, summarizeChanges, unionComments } from '@/lib/merge'
import { readStoredProject } from '@/lib/storage'
import { hydrateStore, storeGet, storeRemove, storeSet } from '@/lib/store'
import type { ChangeSummary, MergeResult, Resolution } from '@/lib/merge'
import type { Project } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

export interface BranchMeta {
  id: string
  name: string
  /** optional one-line purpose, set at creation ("Summer campaign") */
  description?: string
  createdAt: number
  /** id of the user who created it. Absent on drafts made before ownership was
   *  tracked — those stay shared, since there is no one to attribute them to. */
  createdBy?: string
}

/** what a draft row displays: what it changed, and whether applying will conflict */
export interface DraftStatus {
  summary: ChangeSummary
  conflictCount: number
}

export { MAIN_ID } // the canonical definition lives in usePersistence

const branches = ref<BranchMeta[]>([{ id: MAIN_ID, name: 'Main', createdAt: 0 }])
let metaLoaded = false

/** per-draft status cache; entries invalidate on switch/apply/edit-elsewhere */
const statusCache = ref(new Map<string, DraftStatus>())

function baseStorageKey(branchId: string) {
  return `guano-base:${branchId}`
}

export function useBranches() {
  const { project } = useProject()
  const { userId } = useAuth()
  const { saveNow, adoptRemote, commitReplacement } = usePersistence()

  if (!metaLoaded) {
    metaLoaded = true
    try {
      const raw = storeGet(BRANCHES_META_KEY)
      if (raw) {
        const meta = JSON.parse(raw) as { branches: BranchMeta[] }
        if (Array.isArray(meta.branches) && meta.branches.some((b) => b.id === MAIN_ID)) {
          branches.value = meta.branches
        }
      }
    } catch {
      // corrupt meta — fall back to Main only
    }
  }

  const activeBranch = computed(
    () => branches.value.find((b) => b.id === activeBranchId.value) ?? branches.value[0]!,
  )
  const onMain = computed(() => activeBranchId.value === MAIN_ID)

  function saveMeta() {
    storeSet(
      BRANCHES_META_KEY,
      JSON.stringify({ activeId: activeBranchId.value, branches: branches.value }),
    )
  }

  const readProject = readStoredProject

  /** snapshot the current project as a new draft (branch) and switch to it */
  function createBranch(name: string, description?: string) {
    saveNow()
    const id = uid()
    const snapshot = JSON.stringify(project.value)
    storeSet(projectStorageKey(id), snapshot)
    storeSet(baseStorageKey(id), snapshot) // three-way merge base
    branches.value = [
      ...branches.value,
      {
        id,
        name: name.trim() || 'Draft',
        description: description?.trim() || undefined,
        createdAt: Date.now(),
        createdBy: userId.value ?? undefined,
      },
    ]
    activeBranchId.value = id
    // the project and base keys were just written with these exact bytes, so
    // this only adopts them — a write here would land under the new branch
    // key for a second time
    adoptRemote(JSON.parse(snapshot) as Project) // fresh undo history on the branch
    saveMeta()
  }

  async function switchBranch(id: string) {
    if (id === activeBranchId.value) return
    await saveNow() // current branch's work lands under its own key first
    await hydrateStore([projectStorageKey(id)])
    const target = readProject(projectStorageKey(id))
    if (!target) return
    // comments are shared across branches, which is physically a copy carried
    // on every switch: each branch is a whole project blob with its own list.
    // A UNION, never an overwrite — assigning this branch's list wiped every
    // comment the branch being opened held that this one did not, which is how
    // an agent's note on a draft disappeared the moment anyone switched to it.
    target.comments = unionComments(project.value.comments ?? [], target.comments ?? [])
    activeBranchId.value = id
    adoptRemote(target) // read from this branch's key a moment ago
    saveMeta()
  }

  async function deleteBranch(id: string) {
    if (id === MAIN_ID) return
    if (activeBranchId.value === id) await switchBranch(MAIN_ID)
    storeRemove(projectStorageKey(id))
    storeRemove(baseStorageKey(id))
    branches.value = branches.value.filter((b) => b.id !== id)
    saveMeta()
  }

  /** dry-run the three-way merge so the UI can offer conflict choices */
  async function previewMerge(id: string): Promise<MergeResult | null> {
    await saveNow()
    await hydrateStore([baseStorageKey(id), projectStorageKey(id), projectStorageKey(MAIN_ID)])
    const base = readProject(baseStorageKey(id))
    const theirs = readProject(projectStorageKey(id))
    const mine = onMain.value ? project.value : readProject(projectStorageKey(MAIN_ID))
    if (!base || !theirs || !mine) return null
    return computeMerge(base, mine, theirs)
  }

  /**
   * Applies the draft to Main with the given conflict picks. By default the
   * draft is deleted afterwards; with `keep` it survives, and its merge base
   * is rebased onto the merged Main so future diffs show only new divergence.
   */
  async function mergeIntoMain(
    id: string,
    choices: Record<string, Resolution>,
    opts: { keep?: boolean } = {},
  ): Promise<boolean> {
    const result = await previewMerge(id)
    if (!result) return false
    // the Main the merge was computed FROM: handing it over as the baseline is
    // what lets a change that landed on Main while the dialog was open merge
    // in rather than be overwritten
    const mainUsed = onMain.value
      ? JSON.stringify(project.value)
      : (storeGet(projectStorageKey(MAIN_ID)) ?? null)
    const merged = applyResolutions(result, choices)
    // `merged.comments` is computeMerge's union of both sides and is already
    // right. This used to overwrite it with the ACTIVE session's list, so
    // applying from the draft destroyed every comment left on Main since it
    // branched, and applying from Main destroyed every comment left on the
    // draft — whichever side the person happened to be sitting on won.
    activeBranchId.value = MAIN_ID
    const snapshot = await commitReplacement(merged, mainUsed)
    if (opts.keep) {
      // the snapshot actually STORED, which differs from `merged` when Main
      // moved — otherwise the kept draft's base disagrees with the new Main
      // and the next diff shows divergence nobody authored
      storeSet(baseStorageKey(id), snapshot)
      // the kept draft adopts the merged state too — it applied cleanly, so
      // it starts over from the new Main instead of re-proposing old edits
      storeSet(projectStorageKey(id), snapshot)
      statusCache.value.delete(id)
    } else {
      await deleteBranch(id)
    }
    saveMeta()
    return true
  }

  /** what the draft changed vs its base + how many conflicts applying would hit */
  async function draftStatus(id: string, opts: { fresh?: boolean } = {}): Promise<DraftStatus | null> {
    if (id === MAIN_ID) return null
    if (!opts.fresh && statusCache.value.has(id)) return statusCache.value.get(id)!
    // the active draft's latest edits live in memory — commit them first so
    // the stored project reflects what the user sees
    if (activeBranchId.value === id) saveNow()
    await hydrateStore([baseStorageKey(id), projectStorageKey(id), projectStorageKey(MAIN_ID)])
    const base = readProject(baseStorageKey(id))
    const branch = activeBranchId.value === id ? project.value : readProject(projectStorageKey(id))
    const main = onMain.value ? project.value : readProject(projectStorageKey(MAIN_ID))
    if (!base || !branch) return null
    const status: DraftStatus = {
      summary: summarizeChanges(base, branch),
      conflictCount: main ? computeMerge(base, main, branch).conflicts.length : 0,
    }
    statusCache.value.set(id, status)
    return status
  }

  function invalidateDraftStatus(id?: string) {
    if (id) statusCache.value.delete(id)
    else statusCache.value.clear()
  }

  return {
    branches,
    activeBranch,
    activeBranchId,
    onMain,
    createBranch,
    switchBranch,
    deleteBranch,
    previewMerge,
    mergeIntoMain,
    draftStatus,
    invalidateDraftStatus,
  }
}
