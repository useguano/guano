import { onBeforeUnmount, onMounted } from 'vue'
import { usePersistence } from './usePersistence'
import { isDeliberateNavigation } from './navigationIntent'

export function useUnloadGuard() {
  const { hasUnsavedWork, saveNow } = usePersistence()

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDeliberateNavigation() || !hasUnsavedWork.value) return
    e.preventDefault()
    e.returnValue = ''
  }

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
