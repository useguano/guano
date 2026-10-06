<script setup lang="ts">
// Body of the comment popover (rendered by the app PopoverHost, anchored to
// the marker pin). Posting, replies, resolve/delete.
import { ref } from 'vue'
import { Check, CornerDownLeft, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useComments } from '@/composables/useComments'
import { timeAgo } from '@/lib/time'
import type { Comment } from '@/types/editor'

const props = defineProps<{ comment: Comment }>()

const { removeComment, toggleResolved, reply } = useComments()

const draft = ref('')

function submit() {
  if (!draft.value.trim()) return
  // the first message becomes the comment itself, the rest are replies
  if (!props.comment.text) props.comment.text = draft.value.trim()
  else reply(props.comment.id, draft.value)
  draft.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-3 p-3">
    <div v-if="comment.text" class="flex flex-col gap-0.5">
      <p class="text-xs font-medium">{{ comment.author }} says:</p>
      <p class="text-xs">{{ comment.text }}</p>
      <p class="text-[10px] text-muted-foreground">Posted {{ timeAgo(comment.createdAt) }}</p>
    </div>

    <div
      v-for="r in comment.replies"
      :key="r.id"
      class="flex flex-col gap-0.5 border-l-2 border-input pl-2"
    >
      <p class="text-xs font-medium">{{ r.author }} says:</p>
      <p class="text-xs">{{ r.text }}</p>
      <p class="text-[10px] text-muted-foreground">Posted {{ timeAgo(r.createdAt) }}</p>
    </div>

    <div class="relative">
      <InputUI
        v-model="draft"
        class="!pr-7"
        :placeholder="comment.text ? 'Reply…' : 'Add a comment…'"
        @keydown.enter="submit"
      />
      <button
        v-tooltip="'Press Enter to post'"
        class="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        @click="submit"
      >
        <CornerDownLeft class="size-3.5" />
      </button>
    </div>

    <div class="flex items-center gap-1">
      <ButtonUI
        variant="outline"
        size="sm"
        :icon="Check"
        class="flex-1"
        @click="toggleResolved(comment.id)"
      >
        {{ comment.resolved ? 'Unresolve' : 'Resolve' }}
      </ButtonUI>
      <ButtonUI
        variant="outline"
        size="sm"
        :icon="Trash2"
        class="flex-1"
        @click="removeComment(comment.id)"
      >
        Delete
      </ButtonUI>
    </div>
  </div>
</template>
