import { ref } from 'vue'

export type Theme = 'dark' | 'light'

/**
 * The EDITOR chrome's own light/dark — never the site's. The published page's
 * colour mode is `COLOR_MODE_KEY` in `lib/shared/colorMode.js`, which was this
 * same `superbird-theme` until they turned out to be ONE entry: under the `server`
 * publish method the admin and the site are the same origin, so setting the
 * chrome to light re-themed your own published site, and a visitor's toggle
 * flipped the chrome on next open.
 */
const KEY = 'superbird-editor-theme'
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
