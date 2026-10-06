import { defineAsyncComponent, ref } from 'vue'
import type { MediaAsset, MediaKind } from '@/types/media'
import { useModal } from './useModal'

// opened on demand, never on first paint — split out of the editor chunk
const MediaLibraryModal = defineAsyncComponent(() => import('@/components/shared/MediaLibraryModal.vue'))

/**
 * Opens the media library through the app modal host, with an added "select"
 * mode: openSelect() resolves a promise with the picked asset (or null if the
 * modal closes without a pick), so callers — the image src picker,
 * Preview-mode swap — can `await` a choice.
 */

/** when set, the modal is in select mode and filters to these kinds */
const selectAccept = ref<MediaKind[] | null>(null)

let resolvePick: ((asset: MediaAsset | null) => void) | null = null

export function useMediaLibrary() {
  const { openModal } = useModal()

  /** browse/manage mode (AppHeader) */
  function openLibrary() {
    finishPick(null) // abandon any in-flight select
    selectAccept.value = null
    void openModal(MediaLibraryModal)
  }

  /** select mode: resolves with the chosen asset, or null if closed/cancelled.
   *  `accept` limits the grid to those kinds (undefined = all). */
  function openSelect(accept?: MediaKind[]): Promise<MediaAsset | null> {
    finishPick(null)
    selectAccept.value = accept ?? null
    const picked = new Promise<MediaAsset | null>((resolve) => {
      resolvePick = resolve
    })
    void openModal(MediaLibraryModal).then(() => {
      finishPick(null) // closing without a pick resolves the pending promise
      selectAccept.value = null
    })
    return picked
  }

  /** called by the modal when the user picks in select mode (it closes itself after) */
  function pick(asset: MediaAsset) {
    finishPick(asset)
  }

  function finishPick(asset: MediaAsset | null) {
    if (resolvePick) {
      resolvePick(asset)
      resolvePick = null
    }
  }

  return { selectAccept, openLibrary, openSelect, pick }
}
