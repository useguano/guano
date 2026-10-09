import { computed, effectScope, watch } from 'vue'
import { useSettings } from './useSettings'
import { themeBlock, isThemeValue, fontFaceBlock } from '@/lib/settings'
import { PROSE_CSS, CUSTOM_VARIANTS } from '@/lib/shared/prose.js'

const CHROME_COLOR_VARS = [
  'background', 'foreground', 'input',
  'muted', 'muted-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'accent', 'accent-foreground',
  'success', 'pending', 'danger',
  'state-class', 'layer-component', 'layer-cms',
]

let started = false
let styleEl: HTMLStyleElement | null = null
let fontFaceEl: HTMLStyleElement | null = null
let fontLinkEl: HTMLLinkElement | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function useThemeTokens() {
  if (started) return
  started = true
  effectScope(true).run(start)
}

function start() {
  const { settings, effectiveTokens } = useSettings()
  const block = computed(() => {
    const tokens = effectiveTokens.value
    const theme = themeBlock({ ...settings.value, tokens })
    const reassert = CHROME_COLOR_VARS.map((n) => `  --color-${n}: var(--${n});`).join('\n')
    const scoped = tokens.map((t) => `  --color-${t.name}: ${t.value};`).join('\n')
    const root = settings.value.theme?.rootFontSize
    const rootRule = root && isThemeValue(root) ? `  font-size: ${root};\n` : ''
    return (
      `${CUSTOM_VARIANTS}\n${PROSE_CSS}\n${theme}\n:root {\n${reassert}\n}\n` +
      `[data-site-scope] {\n${rootRule}${scoped}\n}`
    )
  })
  const fontsUrl = computed(() => {
    const url = settings.value.fonts.googleFontsUrl ?? ''
    return url.startsWith('https://fonts.googleapis.com/') ? url : ''
  })
  const faces = computed(() => fontFaceBlock(settings.value))

  watch(
    block,
    (css) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!styleEl) {
          styleEl = document.createElement('style')
          styleEl.type = 'text/tailwindcss'
          document.head.appendChild(styleEl)
        }
        styleEl.textContent = css
      }, 200)
    },
    { immediate: true },
  )

  watch(
    faces,
    (css) => {
      if (!css) {
        fontFaceEl?.remove()
        fontFaceEl = null
        return
      }
      if (!fontFaceEl) {
        fontFaceEl = document.createElement('style')
        fontFaceEl.dataset.guanoFonts = ''
        document.head.appendChild(fontFaceEl)
      }
      fontFaceEl.textContent = css
    },
    { immediate: true },
  )

  watch(
    fontsUrl,
    (url) => {
      if (!url) {
        fontLinkEl?.remove()
        fontLinkEl = null
        return
      }
      if (!fontLinkEl) {
        fontLinkEl = document.createElement('link')
        fontLinkEl.rel = 'stylesheet'
        document.head.appendChild(fontLinkEl)
      }
      fontLinkEl.href = url
    },
    { immediate: true },
  )
}
