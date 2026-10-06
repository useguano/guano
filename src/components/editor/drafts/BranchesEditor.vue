<script setup lang="ts">
// The Drafts panel: create/switch/discard drafts and launch the apply flow.
// A draft is a private copy of the project (a branch internally); applying
// it merges into Main via ApplyDraftModal.
import { defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue'
import { GitBranch, Plus, TriangleAlert } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useBranches, MAIN_ID } from '@/composables/useBranches'
import { useModal } from '@/composables/useModal'
import { changeSummaryLabel, hasChanges } from '@/lib/merge'
import { timeAgoShort } from '@/lib/time'
import type { BranchMeta, DraftStatus } from '@/composables/useBranches'

// opened on demand, never on first paint — split out of the editor chunk
const ApplyDraftModal = defineAsyncComponent(() => import('@/components/editor/drafts/ApplyDraftModal.vue'))

const {
  branches,
  activeBranch,
  activeBranchId,
  onMain,
  createBranch,
  switchBranch,
  deleteBranch,
  draftStatus,
  invalidateDraftStatus,
} = useBranches()

const drafts = () => branches.value.filter((b) => b.id !== MAIN_ID)

// --- create form ---

const creating = ref(false)
const newName = ref('')

function create() {
  if (!newName.value.trim()) return
  createBranch(newName.value)
  newName.value = ''
  creating.value = false
}

// --- per-draft status (change summary + conflict count), loaded lazily ---

const statuses = reactive(new Map<string, DraftStatus>())

async function loadStatuses(fresh = false) {
  for (const draft of drafts()) {
    const status = await draftStatus(draft.id, { fresh })
    if (status) statuses.set(draft.id, status)
  }
}

onMounted(() => loadStatuses(true))
// switching drafts changes what "changed vs base" means for the one we left
watch(activeBranchId, () => loadStatuses(true))

function statusLine(id: string): string {
  const status = statuses.get(id)
  if (!status) return ''
  if (!hasChanges(status.summary)) return 'No changes yet'
  return `${changeSummaryLabel(status.summary)} changed`
}

// --- apply / discard flows ---

const { openModal, confirm } = useModal()

async function applyDraft(draft: BranchMeta) {
  await openModal(ApplyDraftModal, { branch: draft })
  loadStatuses(true)
}

function discardMessage(draft: BranchMeta): string {
  const status = statuses.get(draft.id)
  const changes =
    status && hasChanges(status.summary) ? ` and its changes (${changeSummaryLabel(status.summary)})` : ''
  return `This deletes “${draft.name}”${changes}. Main and the live site are not affected.`
}

async function discardDraft(draft: BranchMeta) {
  const ok = await confirm({
    title: 'Discard draft',
    message: discardMessage(draft),
    confirmLabel: 'Discard',
  })
  if (!ok) return
  await deleteBranch(draft.id)
  invalidateDraftStatus(draft.id)
  statuses.delete(draft.id)
}
</script>

<template>
  <!-- where you are -->
  <GroupPopover>
    <div class="flex items-center gap-2">
      <GitBranch class="size-3.5 shrink-0" :class="onMain ? 'text-muted-foreground' : 'text-pending'" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium">
          {{ onMain ? 'You’re on Main' : `Editing “${activeBranch.name}”` }}
        </p>
        <p class="text-[10px] text-muted-foreground">
          {{ onMain ? 'Changes here go live when you publish.' : 'Changes stay in this draft until you merge them into Main.' }}
        </p>
      </div>
      <ButtonUI v-if="!onMain" variant="outline" size="sm" @click="switchBranch(MAIN_ID)">
        Back to Main
      </ButtonUI>
    </div>
  </GroupPopover>

  <!-- drafts -->
  <GroupPopover v-if="drafts().length" label="Drafts">
    <div
      v-for="draft in drafts()"
      :key="draft.id"
      class="flex flex-col gap-1.5 rounded-md border p-2"
      :class="draft.id === activeBranchId ? 'border-accent' : 'border-input'"
    >
      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline justify-between gap-2">
          <span class="min-w-0 truncate text-xs font-medium">{{ draft.name }}</span>
          <span class="shrink-0 text-[10px] text-muted-foreground">{{ timeAgoShort(draft.createdAt) }}</span>
        </div>
        <p v-if="draft.description" class="text-[10px] text-muted-foreground">
          {{ draft.description }}
        </p>
        <p v-if="statusLine(draft.id)" class="text-[10px] text-muted-foreground">
          {{ statusLine(draft.id) }}
        </p>
        <p
          v-if="(statuses.get(draft.id)?.conflictCount ?? 0) > 0"
          class="flex items-center gap-1 text-[10px] text-pending"
        >
          <TriangleAlert class="size-3 shrink-0" />
          {{ statuses.get(draft.id)!.conflictCount }}
          {{ statuses.get(draft.id)!.conflictCount === 1 ? 'conflict' : 'conflicts' }} with Main
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <ButtonUI
          v-if="draft.id !== activeBranchId"
          variant="outline"
          size="sm"
          class="flex-1"
          @click="switchBranch(draft.id)"
        >
          Open
        </ButtonUI>
        <ButtonUI variant="default" size="sm" class="flex-1" @click="applyDraft(draft)">
          Merge
        </ButtonUI>
        <ButtonUI
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-danger"
          @click="discardDraft(draft)"
        >
          Discard
        </ButtonUI>
      </div>
    </div>
  </GroupPopover>

  <!-- empty state -->
  <GroupPopover v-else>
    <div
      class="flex aspect-square flex-col items-center justify-center gap-3 mt-1 rounded-xl border border-input p-4 text-center"
    >
      <GitBranch class="size-6 text-muted-foreground/50" />
      <div>
        <p class="text-xs font-medium text-muted-foreground">No drafts yet</p>
        <p class="text-[10px] font-medium text-muted-foreground/75">Create one to try changes safely</p>
      </div>
    </div>
  </GroupPopover>

  <!-- create: one inline row — name + confirm -->
  <GroupPopover>
    <ButtonUI
      v-if="!creating"
      variant="outline"
      size="sm"
      :icon="Plus"
      class="w-full"
      @click="creating = true"
    >
      New draft
    </ButtonUI>
    <div v-else class="flex items-center gap-1.5">
      <InputUI v-model="newName" placeholder="Draft name" @keydown.enter="create" />
      <ButtonUI variant="default" size="sm" :disabled="!newName.trim()" @click="create">
        Create
      </ButtonUI>
    </div>
  </GroupPopover>

</template>
