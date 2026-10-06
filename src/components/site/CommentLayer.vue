<script setup lang="ts">
// Floating comment pins over a scroll container (the content preview). Pins
// are element-anchored, so their screen position is recomputed from each
// node's live rect every frame — tracking scroll, reflow, and content edits.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import CommentMarker from '@/components/shared/CommentMarker.vue'
import { useComments } from '@/composables/useComments'
import { usePage } from '@/composables/usePage'
import { anchorScreenPos } from '@/lib/commentAnchor'
import type { Comment } from '@/types/editor'

const props = defineProps<{ root: HTMLElement | null }>()

const { visibleComments } = useComments()
const { activePage } = usePage()

const pins = ref<{ comment: Comment; x: number; y: number }[]>([])
let raf = 0
let lastSig = ''

const sig = (list: { comment: Comment; x: number; y: number }[]) =>
  list.map((p) => `${p.comment.id}:${Math.round(p.x)}:${Math.round(p.y)}`).join('|')

function recompute() {
  const root = props.root
  if (root) {
    const next: { comment: Comment; x: number; y: number }[] = []
    for (const comment of visibleComments(activePage.value.id)) {
      if (!comment.anchor) continue
      const pos = anchorScreenPos(comment.anchor, root)
      if (pos) next.push({ comment, x: pos.x, y: pos.y })
    }
    // only touch reactive state when something actually moved
    const s = sig(next)
    if (s !== lastSig) {
      pins.value = next
      lastSig = s
    }
  }
  raf = requestAnimationFrame(recompute)
}

onMounted(() => (raf = requestAnimationFrame(recompute)))
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="pointer-events-none fixed inset-0 z-40">
    <div
      v-for="pin in pins"
      :key="pin.comment.id"
      class="pointer-events-auto absolute"
      :style="{ left: `${pin.x}px`, top: `${pin.y}px` }"
    >
      <CommentMarker :comment="pin.comment" :zoom="1" />
    </div>
  </div>
</template>
