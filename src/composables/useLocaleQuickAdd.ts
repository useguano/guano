import { nextTick, ref } from 'vue'
import { useLocale } from './useLocale'

/**
 * UI state for the header's quick add/delete locale flow (full locale
 * management lives in Project Settings). Per-instance factory, not a
 * singleton — the state belongs to the dropdown that renders it.
 */
export function useLocaleQuickAdd() {
  const { addLocale, setActiveLocale } = useLocale()

  const addingLocale = ref(false)
  const newLocale = ref('')
  const newLocaleInput = ref<HTMLInputElement>()

  function startAddLocale() {
    addingLocale.value = true
    newLocale.value = ''
    nextTick(() => newLocaleInput.value?.focus())
  }

  function confirmAddLocale(close: () => void) {
    const added = addLocale(newLocale.value)
    if (!added) return // invalid or duplicate: keep the input open
    setActiveLocale(added)
    addingLocale.value = false
    close()
  }

  return { addingLocale, newLocale, newLocaleInput, startAddLocale, confirmAddLocale }
}
