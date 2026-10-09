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
  description?: string
  createdAt: number

  createdBy?: string
}

export interface DraftStatus {
  summary: ChangeSummary
  conflictCount: number
}

export { MAIN_ID }

const branches = ref<BranchMeta[]>([{ id: MAIN_ID, name: 'Main', createdAt: 0 }])
let metaLoaded = false

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

  function createBranch(name: string, description?: string) {
    saveNow()
    const id = uid()
    const snapshot = JSON.stringify(project.value)
    storeSet(projectStorageKey(id), snapshot)
    storeSet(baseStorageKey(id), snapshot)
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
    adoptRemote(JSON.parse(snapshot) as Project)
    saveMeta()
  }

  async function switchBranch(id: string) {
    if (id === activeBranchId.value) return
    await saveNow()
    await hydrateStore([projectStorageKey(id)])
    const target = readProject(projectStorageKey(id))
    if (!target) return
    target.comments = unionComments(project.value.comments ?? [], target.comments ?? [])
    activeBranchId.value = id
    adoptRemote(target)
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

  async function previewMerge(id: string): Promise<MergeResult | null> {
    await saveNow()
    await hydrateStore([baseStorageKey(id), projectStorageKey(id), projectStorageKey(MAIN_ID)])
    const base = readProject(baseStorageKey(id))
    const theirs = readProject(projectStorageKey(id))
    const mine = onMain.value ? project.value : readProject(projectStorageKey(MAIN_ID))
    if (!base || !theirs || !mine) return null
    return computeMerge(base, mine, theirs)
  }

  async function mergeIntoMain(
    id: string,
    choices: Record<string, Resolution>,
    opts: { keep?: boolean } = {},
  ): Promise<boolean> {
    const result = await previewMerge(id)
    if (!result) return false
    const mainUsed = onMain.value
      ? JSON.stringify(project.value)
      : (storeGet(projectStorageKey(MAIN_ID)) ?? null)
    const merged = applyResolutions(result, choices)
    activeBranchId.value = MAIN_ID
    const snapshot = await commitReplacement(merged, mainUsed)
    if (opts.keep) {
      storeSet(baseStorageKey(id), snapshot)
      storeSet(projectStorageKey(id), snapshot)
      statusCache.value.delete(id)
    } else {
      await deleteBranch(id)
    }
    saveMeta()
    return true
  }

  async function draftStatus(id: string, opts: { fresh?: boolean } = {}): Promise<DraftStatus | null> {
    if (id === MAIN_ID) return null
    if (!opts.fresh && statusCache.value.has(id)) return statusCache.value.get(id)!
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
