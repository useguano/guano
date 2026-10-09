import { computed, ref } from 'vue'
import { useAuth } from './useAuth'
import { useProject } from './useProject'
import { usePage } from './usePage'
import type { Comment, CommentAnchor, CommentReply } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

export type CommentVisibility = 'all' | 'pending' | 'resolved' | 'none'

const visibility = ref<CommentVisibility>('all')

const displayOnCanvas = ref(false)

const commentMode = ref(false)

function currentAuthor(): { author: string; authorId?: string } {
  const { name, email, userId } = useAuth()
  return {
    author: name.value || email.value || 'Someone',
    ...(userId.value ? { authorId: userId.value } : {}),
  }
}

const activeCommentId = ref<string | null>(null)

const focusTick = ref(0)

export function useComments() {
  const { project } = useProject()
  const { setActivePage } = usePage()

  const comments = computed(() => project.value.comments)

  const activeComment = computed(
    () => comments.value.find((c) => c.id === activeCommentId.value) ?? null,
  )

  function matchesVisibility(comment: Comment): boolean {
    switch (visibility.value) {
      case 'all':
        return true
      case 'pending':
        return !comment.resolved
      case 'resolved':
        return comment.resolved
      case 'none':
        return false
    }
  }

  function visibleComments(pageId: string): Comment[] {
    if (!displayOnCanvas.value) return []
    return comments.value.filter((c) => c.pageId === pageId && matchesVisibility(c))
  }

  const filteredComments = computed(() =>
    comments.value.filter(matchesVisibility).slice().sort((a, b) => b.createdAt - a.createdAt),
  )

  const { userId, commentsSeenAt, markCommentsSeen } = useAuth()

  const mine = (entry: Comment | CommentReply) =>
    !!userId.value && entry.authorId === userId.value

  const unseen = (entry: Comment | CommentReply) =>
    entry.createdAt > commentsSeenAt.value && !mine(entry)

  const unseenCount = computed(
    () =>
      comments.value.filter(
        (c) => (c.text ? unseen(c) : false) || (c.replies ?? []).some(unseen),
      ).length,
  )

  const hasUnseen = computed(() => unseenCount.value > 0)

  function addComment(at: {
    pageId: string
    anchor?: CommentAnchor
    breakpointId?: string | null
    x?: number
    y?: number
  }): Comment {
    const comment: Comment = {
      id: uid(),
      ...at,
      text: '',
      ...currentAuthor(),
      resolved: false,
      createdAt: Date.now(),
      replies: [],
    }
    project.value.comments.push(comment)
    displayOnCanvas.value = true
    commentMode.value = false
    activeCommentId.value = comment.id
    return comment
  }

  function removeComment(id: string) {
    project.value.comments = project.value.comments.filter((c) => c.id !== id)
    if (activeCommentId.value === id) activeCommentId.value = null
  }

  function toggleResolved(id: string) {
    const comment = comments.value.find((c) => c.id === id)
    if (comment) comment.resolved = !comment.resolved
  }

  function reply(id: string, text: string) {
    const comment = comments.value.find((c) => c.id === id)
    if (comment && text.trim()) {
      comment.replies.push({
        id: uid(),
        text: text.trim(),
        ...currentAuthor(),
        createdAt: Date.now(),
      })
    }
  }

  function openComment(id: string | null) {
    activeCommentId.value = id
  }

  function goToComment(id: string) {
    const comment = comments.value.find((c) => c.id === id)
    if (!comment) return
    setActivePage(comment.pageId)
    activeCommentId.value = id
    focusTick.value++
  }

  const toggleCommentMode = () => {
    commentMode.value = !commentMode.value
    if (commentMode.value) displayOnCanvas.value = true
  }
  const exitCommentMode = () => (commentMode.value = false)

  return {
    comments,
    unseenCount,
    hasUnseen,
    markCommentsSeen,
    visibility,
    displayOnCanvas,
    commentMode,
    activeCommentId,
    activeComment,
    focusTick,
    visibleComments,
    filteredComments,
    addComment,
    removeComment,
    toggleResolved,
    reply,
    openComment,
    goToComment,
    toggleCommentMode,
    exitCommentMode,
  }
}
