import { ref } from 'vue'
import { usePersistence, projectStorageKey, BRANCHES_META_KEY, MAIN_ID } from './usePersistence'
import { useProject } from './useProject'
import { startEditTracking } from './useEditTracking'
import { hydrateStore, storeGet } from '@/lib/store'
import { hydratePublishState, PUBLISHED_BASELINE_KEY, PUBLISHED_INFO_KEY } from './usePublish'
import { useMedia } from './useMedia'
import { useLiveSync } from './useLiveSync'

const ready = ref(false)
const bootError = ref<string | null>(null)
let started = false

export function useEditorBoot() {
  if (started) return { ready, bootError, reloadPage }
  started = true
  ;(async () => {
    try {
      await hydrateStore([BRANCHES_META_KEY, PUBLISHED_BASELINE_KEY, PUBLISHED_INFO_KEY])
      const meta = storeGet(BRANCHES_META_KEY)
      const activeId = meta ? ((JSON.parse(meta).activeId as string) ?? MAIN_ID) : MAIN_ID
      await hydrateStore([projectStorageKey(activeId), projectStorageKey(MAIN_ID)])
      hydratePublishState()

      const setupName = localStorage.getItem('guano-setup-name')
      if (setupName) {
        if (!storeGet(projectStorageKey(activeId))) {
          useProject().renameProject(setupName)
        }
      }
      localStorage.removeItem('guano-setup-name')

      usePersistence().init()
      startEditTracking()
      useLiveSync().start()
      ready.value = true

      void useMedia()
        .loadMedia()
        .catch(() => {})
    } catch {
      bootError.value = 'Cannot reach the server — is `npm run serve` running?'
    }
  })()
  return { ready, bootError, reloadPage }
}

function reloadPage() {
  window.location.reload()
}
