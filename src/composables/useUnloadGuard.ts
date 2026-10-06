import { onBeforeUnmount, onMounted } from 'vue'
import { usePersistence } from './usePersistence'
import { isDeliberateNavigation } from './navigationIntent'

/**
 * Warn before closing the tab on work the server does not have.
 *
 * Autosave is debounced, and a failed write sits in the store's queue waiting
 * for the next edit to retry it. Closing the tab in either window dropped the
 * edit with nothing said — the one data-loss path in the editor a user could
 * not even notice.
 *
 * There is no `pagehide` re-send to go with it, deliberately. `keepalive`
 * caps a request body at 64 KB and a project blob is hundreds of KB, so the
 * request would simply fail; and the write is already in flight or queued by
 * then, so a second copy of the same bytes could only land out of order. What
 * `pagehide` does instead is ask for the un-settled debounce to be committed
 * now, through the ordinary path.
 */

export function useUnloadGuard() {
  const { hasUnsavedWork, saveNow } = usePersistence()

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDeliberateNavigation() || !hasUnsavedWork.value) return
    // conditional: unconditional would prompt on every ordinary reload
    e.preventDefault()
    e.returnValue = '' // still required by Chrome and Safari
  }

  // not beforeunload: that one does not fire on mobile, or when the page goes
  // into the back/forward cache
  const onPageHide = () => {
    if (isDeliberateNavigation() || !hasUnsavedWork.value) return
    void saveNow()
  }

  onMounted(() => {
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    window.removeEventListener('pagehide', onPageHide)
  })
}
