import { watch, type App } from 'vue'
import { storeFailure } from '@/lib/store'
import { useNotice } from '@/composables/useNotice'
import { usePersistence } from '@/composables/usePersistence'

export function installErrorReporting(app: App) {
  const { notify, clearKey } = useNotice()

  const report = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason ?? '')
    notify({
      kind: 'error',
      title: 'Something went wrong',
      detail: message ? `${message} — your work is still here; reloading is usually safe.` : undefined,
      key: 'app-error',
    })
  }

  app.config.errorHandler = (err, _instance, info) => {
    console.error(err, info)
    report(err)
  }
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason)
    report(e.reason)
  })
  window.addEventListener('error', (e) => {
    console.error(e.error ?? e.message)
    report(e.error ?? e.message)
  })

  watch(storeFailure, (failure) => {
    if (!failure) {
      clearKey('store')
      return
    }
    notify({
      kind: 'error',
      key: 'store',
      title: failure.retryable ? 'Changes not saved' : 'Change rejected',
      detail: failure.message,
      action: failure.retryable
        ? { label: 'Retry', run: () => void usePersistence().saveNow() }
        : undefined,
    })
  })
}
