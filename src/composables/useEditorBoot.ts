import { ref } from 'vue'
import { usePersistence, projectStorageKey, BRANCHES_META_KEY, MAIN_ID } from './usePersistence'
import { useProject } from './useProject'
import { startEditTracking } from './useEditTracking'
import { hydrateStore, storeGet } from '@/lib/store'
import { hydratePublishState, PUBLISHED_BASELINE_KEY, PUBLISHED_INFO_KEY } from './usePublish'
import { useMedia } from './useMedia'
import { useLiveSync } from './useLiveSync'

// Shared admin-zone boot: hydrate the server-backed store and start
// persistence. Lives at module scope so it runs exactly once no matter
// which admin view (BuildView / PreviewView) mounts first — a deep-link or
// refresh at /admin/preview boots the same project the editor would.
const ready = ref(false)
const bootError = ref<string | null>(null)
let started = false

export function useEditorBoot() {
  if (started) return { ready, bootError, reloadPage }
  started = true
  ;(async () => {
    try {
      // purge pre-server-storage localStorage copies of the project so they
      // can never leak back into a fresh install (theme + setup-name stay)
      for (const k of Object.keys(localStorage)) {
        if (
          k === 'superbird-project' ||
          k === 'superbird-branches' ||
          k === 'superbird-published-baseline' ||
          k === 'superbird-published-info' ||
          k.startsWith('superbird-project:') ||
          k.startsWith('superbird-base:')
        ) {
          localStorage.removeItem(k)
        }
      }
      await hydrateStore([BRANCHES_META_KEY, PUBLISHED_BASELINE_KEY, PUBLISHED_INFO_KEY])
      const meta = storeGet(BRANCHES_META_KEY)
      const activeId = meta ? ((JSON.parse(meta).activeId as string) ?? MAIN_ID) : MAIN_ID
      // Main's key too: publish/the Unpublished dot always read Main, even
      // when the session resumes straight onto a draft (hydrateStore de-dupes)
      await hydrateStore([projectStorageKey(activeId), projectStorageKey(MAIN_ID)])
      hydratePublishState()

      // fresh install: no stored project yet, so init() will persist the
      // in-memory default. Apply the name captured at setup before that
      // first snapshot is taken, then clear the stash so it can't leak.
      // old key read too: a setup finished on the pre-rename build hands
      // its name to this one exactly once
      const setupName =
        localStorage.getItem('guano-setup-name') ?? localStorage.getItem('superbird-setup-name')
      if (setupName) {
        if (!storeGet(projectStorageKey(activeId))) {
          useProject().renameProject(setupName)
        }
      }
      localStorage.removeItem('guano-setup-name')
      localStorage.removeItem('superbird-setup-name')

      usePersistence().init() // sync, runs against the warm cache
      startEditTracking() // stamp updatedAt/updatedBy on edited pages/entries
      useLiveSync().start() // live-apply + hard-lock for MCP agent sessions
      ready.value = true

      // the media index is non-critical to boot — load it in the background so
      // a media outage never blocks the editor; the library modal retries on
      // open. Both admin views boot through here, so Preview gets it too.
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
