<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Check, MessageCircle } from 'lucide-vue-next'
import CommentThread from '@/components/shared/CommentThread.vue'
import { useComments } from '@/composables/useComments'
import { usePopover } from '@/composables/usePopover'
import type { Comment } from '@/types/editor'

const props = defineProps<{
  comment: Comment
  /** canvas zoom, countered so pins keep a constant screen size */
  zoom: number
}>()

// The pin's tail is its bottom-left corner (`rounded-bl-none`), so that corner
// is what has to sit on the anchored point — positioned by its top-left, the
// pin hung a full pin-height below wherever you clicked. `translateY(-100%)`
// runs AFTER the scale in local space, so the shift is the pin's VISUAL height
// at any zoom.
const pinTransform = computed(() => `scale(${1 / props.zoom}) translateY(-100%)`)

const { activeCommentId, openComment, removeComment } = useComments()
const { currentId, openPopover, closePopover } = usePopover()

const open = computed(() => activeCommentId.value === props.comment.id)
const popoverId = computed(() => `comment-${props.comment.id}`)
const pinEl = ref<HTMLElement>()

function toggle() {
  if (open.value) closePopover()
  else openComment(props.comment.id)
}

// the thread renders in the app PopoverHost, rAF-anchored to the pin — it
// follows canvas pan/zoom for free (getBoundingClientRect ignores transforms)
function openThread() {
  if (!pinEl.value) return
  openPopover({
    id: popoverId.value,
    component: CommentThread,
    props: { comment: props.comment },
    anchor: pinEl.value,
    placement: 'right-start',
    title: 'Comment',
    onClose: () => {
      // discard pins that never got any text
      if (!props.comment.text && !props.comment.replies.length) removeComment(props.comment.id)
      // only clear the selection if another comment hasn't already taken it
      if (activeCommentId.value === props.comment.id) openComment(null)
    },
  })
}

watch(open, (isOpen) => {
  if (isOpen) openThread()
  else if (currentId.value === popoverId.value) closePopover()
})
// the comment may already be active when the marker mounts (jump-to-comment)
onMounted(() => {
  if (open.value) openThread()
})
</script>

<template>
  <div
    class="origin-top-left"
    :class="open ? 'relative z-20' : 'z-10'"
    :style="{ transform: pinTransform }"
    @click.stop
    @pointerdown.stop
  >
    <button
      ref="pinEl"
      :aria-label="comment.resolved ? 'Resolved comment pin' : 'Comment pin'"
      class="flex size-7 cursor-pointer items-center justify-center rounded-full rounded-bl-none border-2 border-white shadow-md"
      :class="comment.resolved ? 'bg-muted-foreground' : 'bg-sky-500'"
      @click="toggle"
    >
      <component :is="comment.resolved ? Check : MessageCircle" class="size-3.5 text-white" />
    </button>
  </div>
</template>
