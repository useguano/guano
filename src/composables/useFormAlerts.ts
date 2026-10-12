import { computed, defineAsyncComponent, ref } from 'vue'
import { useAuth } from './useAuth'
import { useModal } from './useModal'

const FormSubmissionsModal = defineAsyncComponent(
  () => import('@/components/editor/forms/FormSubmissionsModal.vue'),
)

const newCount = ref(0)
let inFlight: Promise<void> | null = null

export function useFormAlerts() {
  const { canBuild, markFormsSeen } = useAuth()
  const { openModal } = useModal()

  const hasNew = computed(() => newCount.value > 0)

  async function refresh(): Promise<void> {
    if (!canBuild.value) {
      newCount.value = 0
      return
    }
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const res = await fetch('/api/forms')
        if (!res.ok) {
          newCount.value = 0
          return
        }
        const body = (await res.json()) as { newTotal?: number }
        newCount.value = typeof body.newTotal === 'number' ? body.newTotal : 0
      } catch {
        newCount.value = 0
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  async function openSubmissions(): Promise<void> {
    newCount.value = 0
    await markFormsSeen()
    await openModal(FormSubmissionsModal)
    await refresh()
  }

  return { newCount, hasNew, refresh, openSubmissions }
}
