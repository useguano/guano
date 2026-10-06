<script setup lang="ts">
import { onMounted } from 'vue'
import { Check, MessageCirclePlus } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import { timeAgo } from '@/lib/time'
import { useComments, type CommentVisibility } from '@/composables/useComments'
import { usePage } from '@/composables/usePage'
import { useProject } from '@/composables/useProject'
import type { Comment } from '@/types/editor'

const { visibility, displayOnCanvas, filteredComments, goToComment, markCommentsSeen } =
  useComments()

// Opening this panel is what "I have read them" means, so the stamp lives
// here rather than on the rail button: every way of opening it counts, and
// the one that doesn't show the comments (closing it again) doesn't.
onMounted(() => void markCommentsSeen())
const { pages } = usePage()
const { breakpoints } = useProject()

const FILTERS: { label: string; value: CommentVisibility }[] = [
  { label: 'Show all', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Resolved', value: 'resolved' },
]

/** activating a filter deactivates the others; re-clicking clears to none */
function toggleFilter(value: CommentVisibility) {
  visibility.value = visibility.value === value ? 'none' : value
}

function pageOf(comment: Comment) {
  return pages.value.find((p) => p.id === comment.pageId)
}

function locationOf(comment: Comment): string {
  const page = pageOf(comment)
  // an anchored comment carries its frame on the anchor; `comment.breakpointId`
  // is the legacy free-canvas position's. A comment with neither was placed on
  // the Play surface, which has one render and so no breakpoint to name.
  const bpId = comment.anchor?.breakpointId ?? comment.breakpointId
  const breakpoint = breakpoints.value.find((b) => b.id === bpId)
  return `${page?.name ?? 'Unknown page'} · ${breakpoint?.name ?? 'All screens'}`
}
</script>

<template>
  <GroupPopover>
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium">Display on canvas</span>
      <ToggleUI v-model="displayOnCanvas" />
    </div>
  </GroupPopover>

  <GroupPopover>
    <div class="flex gap-1">
      <ButtonUI
        v-for="filter in FILTERS"
        :key="filter.value"
        size="xs"
        class="flex-1"
        :variant="visibility === filter.value ? 'default' : 'outline'"
        @click="toggleFilter(filter.value)"
      >
        {{ filter.label }}
      </ButtonUI>
    </div>

    <div
      v-if="!filteredComments.length"
      class="flex aspect-square flex-col items-center justify-center gap-3 mt-1 rounded-xl border border-input p-4 text-center"
    >
      <MessageCirclePlus class="size-6 text-muted-foreground/50" />
      <div>
        <p class="text-xs font-medium text-muted-foreground">No comments yet</p>
        <p class="text-[10px] font-medium text-muted-foreground/75">
          Press C, then click to place one
        </p>
      </div>
    </div>
    <button
      v-for="comment in filteredComments"
      :key="comment.id"
      class="cursor-pointer rounded-md border border-input p-2 text-left transition-colors hover:bg-accent"
      @click="goToComment(comment.id)"
    >
      <span class="flex items-center justify-between gap-2">
        <span class="truncate text-xs font-medium">{{ locationOf(comment) }}</span>
        <Check v-if="comment.resolved" class="size-3.5 shrink-0 text-muted-foreground" />
      </span>
      <span class="mt-1 line-clamp-2 block text-xs text-muted-foreground">
        {{ comment.text || 'Empty comment' }}
      </span>
      <span class="mt-1 block text-[10px] text-muted-foreground">
        Posted {{ timeAgo(comment.createdAt) }}, by {{ comment.author }}
      </span>
      <span v-if="comment.replies.length" class="mt-1 block text-[10px] text-muted-foreground">
        {{ comment.replies.length }} {{ comment.replies.length === 1 ? 'reply' : 'replies' }}
      </span>
    </button>
  </GroupPopover>
</template>
