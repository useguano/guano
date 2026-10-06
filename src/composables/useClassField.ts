import { computed } from 'vue'

/**
 * Shared wiring for a whitespace-separated class string edited as tokens.
 * Bridges a string source (an element's `classes`, an interaction's
 * `toClasses`, …) to the token array + mutations that `ClassInput` speaks.
 */
export function useClassField(source: { get: () => string; set: (value: string) => void }) {
  const tokens = computed(() => source.get().split(/\s+/).filter(Boolean))

  function setTokens(next: string[]) {
    source.set(next.join(' '))
  }

  function removeToken(cls: string) {
    setTokens(tokens.value.filter((t) => t !== cls))
  }

  return { tokens, setTokens, removeToken }
}
