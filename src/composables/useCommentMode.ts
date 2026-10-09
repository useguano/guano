import { onBeforeUnmount, onMounted } from 'vue'
import { useComments } from './useComments'
import { useKeymap } from './useShortcut'

export function useCommentMode() {
  const { commentMode, activeCommentId, toggleCommentMode, exitCommentMode } = useComments()

  useKeymap([{ key: 'c', handler: toggleCommentMode }])

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && commentMode.value && !activeCommentId.value) {
      exitCommentMode()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { commentMode }
}
