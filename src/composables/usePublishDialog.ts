import { defineAsyncComponent } from 'vue'
import { useModal } from './useModal'

const PublishDialog = defineAsyncComponent(() => import('@/components/shared/PublishDialog.vue'))

export function usePublishDialog() {
  const { openModal, stack } = useModal()

  function openPublish() {
    if (stack.value.some((m) => m.component === PublishDialog)) return
    void openModal(PublishDialog)
  }

  return { openPublish }
}
