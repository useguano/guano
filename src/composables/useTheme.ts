import { ref } from 'vue'

export type Theme = 'dark' | 'light'

const KEY = 'guano-theme'
const legacyTheme = localStorage.getItem('superbird-theme')
if (legacyTheme && !localStorage.getItem(KEY)) localStorage.setItem(KEY, legacyTheme)
localStorage.removeItem('superbird-theme')
const stored = localStorage.getItem(KEY)
const theme = ref<Theme>(stored === 'light' ? 'light' : 'dark')

function apply(value: Theme) {
  document.documentElement.classList.toggle('light', value === 'light')
}
apply(theme.value)

export function useTheme() {
  function setTheme(value: Theme) {
    theme.value = value
    localStorage.setItem(KEY, value)
    apply(value)
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  return { theme, setTheme, toggleTheme }
}
