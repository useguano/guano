import { onBeforeUnmount, onMounted } from 'vue'
import { useComments } from './useComments'
import { useKeymap } from './useShortcut'

/**
 * The comment-drop tool's keyboard behaviour, shared by both editing surfaces
 * (CanvasEditor, PreviewView). Plain `C` toggles the tool on/off; Escape leaves
 * it. `C` is bound with no modifier, so ⌘C stays element-copy — and the keymap
 * skips text fields, so typing "c" never arms the tool. Returns `commentMode`
 * for the view to drive its crosshair cursor and click-to-place gating.
 */
export function useCommentMode() {
  const { commentMode, activeCommentId, toggleCommentMode, exitCommentMode } = useComments()

  useKeymap([{ key: 'c', handler: toggleCommentMode }])

  // Escape leaves the tool — but only when no comment thread is open, so an
  // open thread's own Escape-to-close (CommentMarker) wins first. Doesn't
  // preventDefault/stop: disarming shouldn't block other Escape consumers.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && commentMode.value && !activeCommentId.value) {
      exitCommentMode()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { commentMode }
}
