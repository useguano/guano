import { computed, ref } from 'vue'
import { useAuth } from './useAuth'
import { useProject } from './useProject'
import { usePage } from './usePage'
import type { Comment, CommentAnchor, CommentReply } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

export type CommentVisibility = 'all' | 'pending' | 'resolved' | 'none'

const visibility = ref<CommentVisibility>('all')

/** whether comment pins render on the canvas (off by default) */
const displayOnCanvas = ref(false)

/** comment-drop tool: while on, the canvas shows a crosshair and a click
 * anchors a new comment. Press C to arm it, C or Escape to leave; placing a
 * comment disarms it, so the cursor always goes back on its own. */
const commentMode = ref(false)

/** the display name a comment written NOW is signed with. The name is stored
 * on the comment rather than looked up per render: a rename must not rewrite
 * history, and a deleted user's threads must still read correctly. Falls back
 * to the email, then to "Someone" for a profile that hasn't hydrated yet —
 * never to "You", which is what every comment used to say. */
function currentAuthor(): { author: string; authorId?: string } {
  const { name, email, userId } = useAuth()
  return {
    author: name.value || email.value || 'Someone',
    ...(userId.value ? { authorId: userId.value } : {}),
  }
}

/** comment whose thread popover is open on the canvas */
const activeCommentId = ref<string | null>(null)

/** bumped when the canvas should pan to the active comment */
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

  /** comments to pin on the canvas for a page, honouring the Show filter */
  function visibleComments(pageId: string): Comment[] {
    if (!displayOnCanvas.value) return []
    return comments.value.filter((c) => c.pageId === pageId && matchesVisibility(c))
  }

  /** every comment across all pages, honouring the Show filter (newest first) */
  const filteredComments = computed(() =>
    comments.value.filter(matchesVisibility).slice().sort((a, b) => b.createdAt - a.createdAt),
  )

  // --- unseen activity ---
  // "Unseen" is anything written after the stamp this user last opened the
  // comments panel at, by somebody else. The stamp is per USER and lives on
  // their server record (not localStorage), so the dot is the same on every
  // machine they sign in from. It deliberately ignores the Show filter: a new
  // comment hidden by a filter is still news.
  const { userId, commentsSeenAt, markCommentsSeen } = useAuth()

  const mine = (entry: Comment | CommentReply) =>
    !!userId.value && entry.authorId === userId.value

  const unseen = (entry: Comment | CommentReply) =>
    entry.createdAt > commentsSeenAt.value && !mine(entry)

  /** threads with activity this user hasn't looked at yet */
  const unseenCount = computed(
    () =>
      comments.value.filter(
        // an empty pin is a thread someone abandoned mid-typing, never news
        // `replies` is defensive: an imported blob can arrive without it, and
        // a throw here would take out the rail this renders in
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
    displayOnCanvas.value = true // adding a comment reveals the pins
    // One click, one comment: the tool disarms itself. It used to stay armed
    // so several could be dropped in a row, but the crosshair then outlived
    // the thread that was open for typing, and the next click anywhere —
    // including one meant to dismiss that thread — dropped another empty pin.
    // Press C again for the next one.
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

  /** navigate to a comment: switch to its page and ask the canvas to pan to it */
  function goToComment(id: string) {
    const comment = comments.value.find((c) => c.id === id)
    if (!comment) return
    setActivePage(comment.pageId)
    activeCommentId.value = id
    focusTick.value++
  }

  const toggleCommentMode = () => {
    commentMode.value = !commentMode.value
    if (commentMode.value) displayOnCanvas.value = true // show existing pins too
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
