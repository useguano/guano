import type { DesignToken, ProjectSettings } from '@/types/editor'
import { TOKEN_NAME_RE, RESERVED_TOKEN_NAMES } from './shared/tokens.js'

// token validation, the @theme builder and the title template are shared
// verbatim with the node exporter (server/export.mjs)
export {
  TOKEN_NAME_RE,
  HEX_RE,
  RESERVED_TOKEN_NAMES,
  isValidToken,
  isEmittableToken,
  isReservedToken,
  tokenError,
  themeBlock,
  rootFontSizeCss,
  isThemeValue,
  applyTitleTemplate,
} from './shared/tokens.js'

// custom webfonts: the @font-face builder + the legacy head-code importer,
// shared verbatim with the exporter
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

/** human error for the token name input; null = fine */
export function tokenNameError(name: string, others: DesignToken[]): string | null {
  if (!name) return 'Name required'
  if (!TOKEN_NAME_RE.test(name)) return 'Lowercase letters, digits and dashes only'
  if (others.some((t) => t.name === name)) return 'Duplicate name'
  return null
}

/**
 * A non-blocking note for the token name input; null = nothing to say.
 * Shadowing a palette name used to be a hard error, which forced every brand
 * palette with a colour called "blue" to rename it and rewrite every class. A
 * token defines `bg-blue`, never `bg-blue-500`, so the shades keep working —
 * it is worth flagging, not worth refusing.
 */
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
    // no `smtp` / `integrations`: both are deprecated and server-side now
    // (server/integrations.mjs). Minting them here would recreate the blob
    // fields the boot migration deletes.
    tokens: [],
    customCode: { head: '' },
    fonts: { family: '', googleFontsUrl: undefined, custom: [] },
  }
}
