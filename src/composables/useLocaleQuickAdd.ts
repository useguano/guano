import { nextTick, ref } from 'vue'
import { useLocale } from './useLocale'

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
    if (!added) return
    setActiveLocale(added)
    addingLocale.value = false
    close()
  }

  return { addingLocale, newLocale, newLocaleInput, startAddLocale, confirmAddLocale }
}
