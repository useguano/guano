import { computed } from 'vue'

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
