import { watch, type App } from 'vue'
import { storeFailure } from '@/lib/store'
import { useNotice } from '@/composables/useNotice'
import { usePersistence } from '@/composables/usePersistence'

/**
 * Turn the two silent failure classes into something the user can see.
 *
 * There was no global handler at all, so an uncaught error in a render or a
 * watcher — a malformed blob out of an import or a merge, say — left the
 * editor frozen with no message, no banner and no prompt to reload. And the
 * store threw away the server's own refusal text in favour of
 * "save failed (403)", including the contributor refusals the server takes
 * care to name.
 *
 * Everything still goes to the console first: the dev console remains the
 * debugging surface, and a notice is a summary, not a replacement.
 */
export function installErrorReporting(app: App) {
  const { notify, clearKey } = useNotice()

  const report = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason ?? '')
    notify({
      kind: 'error',
      title: 'Something went wrong',
      detail: message ? `${message} — your work is still here; reloading is usually safe.` : undefined,
      key: 'app-error', // one card however many times it fires
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

  // The store's own failures. Split by whether retrying could ever help: a
  // Retry button on a 403 is a thing people press five times before believing
  // it.
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
