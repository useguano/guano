import type { DesignToken, ProjectSettings } from '@/types/editor'
import { TOKEN_NAME_RE, RESERVED_TOKEN_NAMES, tokenDark } from './shared/tokens.js'

export {
  TOKEN_NAME_RE,
  HEX_RE,
  RESERVED_TOKEN_NAMES,
  isValidToken,
  isEmittableToken,
  isReservedToken,
  tokenError,
  tokenDark,
  modeTokensCss,
  themeBlock,
  rootFontSizeCss,
  isThemeValue,
  applyTitleTemplate,
} from './shared/tokens.js'

export {
  REDIRECT_CODE,
  redirectError,
  isValidRedirect,
  normalizeRedirectPath,
  normalizeRedirectTarget,
  isAbsoluteTarget,
  resolveRedirects,
} from './shared/redirects.js'

export {
  fontFaceBlock,
  fontError,
  fontSrcRefs,
  fontFormatForMime,
  fontFormatForUrl,
  parseFontFaces,
  stripFontFaces,
  validFonts,
  FONT_FAMILY_RE,
} from './shared/fonts.js'

/**
 * What a canvas surface paints under the project — the `background` and
 * `foreground` tokens, resolved for the mode being shown, with white/black
 * when the project names no such token.
 *
 * Deliberately resolved in JS rather than `var(--color-background, #fff)`:
 * useThemeTokens reasserts the EDITOR CHROME's colours as `--color-*` on
 * :root, and custom properties inherit, so the CSS fallback could never fire —
 * a project with no `background` token would have painted its cards and frames
 * in the chrome's own colour.
 */
export function sitePaperStyle(
  settings: ProjectSettings | undefined,
  mode: 'light' | 'dark',
): { backgroundColor: string; color: string } {
  const pick = (name: string, fallback: string) => {
    const token = (settings?.tokens ?? []).find((t) => t.name === name)
    if (!token) return fallback
    return (mode === 'dark' ? tokenDark(token) : null) ?? token.value ?? fallback
  }
  return { backgroundColor: pick('background', '#ffffff'), color: pick('foreground', '#000000') }
}

export function tokenNameError(name: string, others: DesignToken[]): string | null {
  if (!name) return 'Name required'
  if (!TOKEN_NAME_RE.test(name)) return 'Lowercase letters, digits and dashes only'
  if (others.some((t) => t.name === name)) return 'Duplicate name'
  return null
}

export function tokenNameNote(name: string): string | null {
  return RESERVED_TOKEN_NAMES.has(name)
    ? `"${name}" is also a Tailwind color — bg-${name} will mean your token`
    : null
}

export const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'System sans', value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: 'Geist', value: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
  { label: 'Serif', value: 'ui-serif, Georgia, Cambria, serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
]

export function defaultSettings(): ProjectSettings {
  return {
    favicon: undefined,
    publishing: { method: 'server', github: { repo: '', branch: 'main' }, apiOrigin: '' },
    seo: { siteName: '', titleTemplate: '%s', description: '', ogImage: undefined },
    domain: '',
    tokens: [],
    customCode: { head: '' },
    fonts: { family: '', googleFontsUrl: undefined, custom: [] },
  }
}
