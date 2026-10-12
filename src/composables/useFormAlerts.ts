import { computed, defineAsyncComponent } from 'vue'
import { useAuth } from './useAuth'
import { useModal } from './useModal'
import { useFormSubmissions } from './useFormSubmissions'

const FormSubmissionsModal = defineAsyncComponent(
  () => import('@/components/editor/forms/FormSubmissionsModal.vue'),
)

let inFlight: Promise<void> | null = null

export function useFormAlerts() {
  const { canBuild, markFormsSeen } = useAuth()
  const { openModal } = useModal()
  const { forms, newCount, loadForms } = useFormSubmissions()

  const hasNew = computed(() => newCount.value > 0)

  async function refresh(): Promise<void> {
    if (!canBuild.value) {
      newCount.value = 0
      return
    }
    if (inFlight) return inFlight
    inFlight = loadForms()
      .catch(() => {
        newCount.value = 0
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  async function openSubmissions(): Promise<void> {
    newCount.value = 0
    for (const form of forms.value) form.newCount = 0
    await markFormsSeen()
    await openModal(FormSubmissionsModal)
    await refresh()
  }

  return { newCount, hasNew, refresh, openSubmissions }
}
