import { defineAsyncComponent, ref } from 'vue'
import type { MediaAsset, MediaKind } from '@/types/media'
import { useModal } from './useModal'

const MediaLibraryModal = defineAsyncComponent(() => import('@/components/shared/MediaLibraryModal.vue'))

const selectAccept = ref<MediaKind[] | null>(null)

let resolvePick: ((asset: MediaAsset | null) => void) | null = null

export function useMediaLibrary() {
  const { openModal } = useModal()

  function openLibrary() {
    finishPick(null)
    selectAccept.value = null
    void openModal(MediaLibraryModal)
  }

  function openSelect(accept?: MediaKind[]): Promise<MediaAsset | null> {
    finishPick(null)
    selectAccept.value = accept ?? null
    const picked = new Promise<MediaAsset | null>((resolve) => {
      resolvePick = resolve
    })
    void openModal(MediaLibraryModal).then(() => {
      finishPick(null)
      selectAccept.value = null
    })
    return picked
  }

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
