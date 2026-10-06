import { computed, effectScope, watch } from 'vue'
import { useSettings } from './useSettings'
import { themeBlock, isThemeValue, fontFaceBlock } from '@/lib/settings'
import { PROSE_CSS, CUSTOM_VARIANTS } from '@/lib/shared/prose.js'

// --color-* names owned by the editor chrome — keep in sync with the
// `@theme inline` block in assets/main.css. A project token may legally share
// one of these names (e.g. `accent`): the runtime @theme would then put the
// PROJECT value on :root, and the runtime-compiled utility (later in the
// cascade than the prebuilt sheet) would recolor the app chrome itself. So we
// re-assert the chrome mapping globally (unlayered — beats @theme's layer) and
// scope the project values to [data-site-scope] (the canvas frames + the
// preview main): CSS variables resolve per element, so site content gets the
// project palette and the app chrome keeps its own.
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

/**
 * Keeps ONE <style type="text/tailwindcss"> element in the head whose
 * body is the project's @theme token block. The @tailwindcss/browser
 * runtime (already running in both zones) observes it and recompiles,
 * making bg-<token> classes live. Writes are debounced — every mutation
 * triggers a full document recompile, so hex typing must not thrash it.
 * Also maintains the optional Google Fonts stylesheet link.
 */
export function useThemeTokens() {
  if (started) return
  started = true
  // Detached: this runs once for the whole app, but it is CALLED from a
  // component's setup, and watchers created there die with that component.
  // The page canvas unmounts whenever the components board or the Preview
  // takes the centre — and with it went every theme update until a reload.
  effectScope(true).run(start)
}

function start() {
  const { settings, effectiveTokens } = useSettings()
  const block = computed(() => {
    // effective, not just the project's: the components board previews library
    // entries styled with tokens the project may not define yet
    const tokens = effectiveTokens.value
    const theme = themeBlock({ ...settings.value, tokens })
    const reassert = CHROME_COLOR_VARS.map((n) => `  --color-${n}: var(--${n});`).join('\n')
    const scoped = tokens.map((t) => `  --color-${t.name}: ${t.value};`).join('\n')
    // The project's root font-size is applied to the SITE SCOPE here, not to
    // <html> as the export does: an `html { font-size: 15px }` in the editor
    // would rescale the editor's own chrome too. Inherited/`em` type scales
    // correctly in the canvas; `rem`-based utilities still resolve against the
    // editor root, so the canvas approximates what the published page does
    // exactly. (Before this existed, neither surface could express it.)
    const root = settings.value.theme?.rootFontSize
    const rootRule = root && isThemeValue(root) ? `  font-size: ${root};\n` : ''
    // PROSE_CSS is always emitted: it is the same source the exporter compiles,
    // so rich text looks identical on the canvas and on the published page
    return (
      `${CUSTOM_VARIANTS}\n${PROSE_CSS}\n${theme}\n:root {\n${reassert}\n}\n` +
      `[data-site-scope] {\n${rootRule}${scoped}\n}`
    )
  })
  const fontsUrl = computed(() => {
    const url = settings.value.fonts.googleFontsUrl ?? ''
    return url.startsWith('https://fonts.googleapis.com/') ? url : ''
  })
  // registered webfonts — the SAME @font-face CSS the exporter emits, so a
  // custom family looks identical in the canvas, the preview and the published
  // site. (Fonts used to be hand-written into customCode.head, which only the
  // exporter reads, so they were invisible everywhere in the editor.)
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

  // a PLAIN <style>, not the text/tailwindcss one above: @font-face needs no
  // Tailwind processing, and keeping it separate means adding a font doesn't
  // trigger a full utility recompile
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
