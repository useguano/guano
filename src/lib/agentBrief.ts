import type { DesignToken, ProjectSettings } from '@/types/editor'
import { uid } from './shared/ids.js'

/**
 * The brief: a designer's intake compiled into one prompt, plus the parts of
 * it that are facts rather than wishes.
 *
 * A token is a fact, a sentence is a wish. The palette, the radius scale, the
 * colour mode, the fonts and the locales are WRITTEN into the project by the
 * stepper before it sends — the model is told they are already set and to
 * build on them. Everything else is description, because there is no setting
 * that holds "playful grid".
 *
 * Pure data and pure functions, so a brief can be compiled headlessly in a
 * throwaway `.tmp-test.ts` (→ CLAUDE.md).
 */

export type BriefStop = 0 | 1 | 2 | 3

export interface BriefColors {
  primary?: string
  accent?: string
  background?: string
}

export interface BriefReference {
  /** the composer's attachment — the screenshot is what the agent reads */
  name?: string
  /** text only: the spawn allows `mcp__guano__*` and nothing fetches a URL */
  url?: string
}

export interface BriefAnswers {
  subject?: string
  audience?: string
  goal?: string
  pages?: string[]
  palette?: string
  colors?: BriefColors
  colorMode?: 'light' | 'dark' | 'system'
  shape?: BriefStop
  grid?: BriefStop
  motion?: BriefStop
  tone?: string[]
  font?: string
  imagery?: string[]
  /** the first is the default locale */
  locales?: string[]
  logoPath?: string
  brandFonts?: string
  references?: BriefReference[]
  law?: string
}

export interface CompiledBrief {
  /** the one message the stepper sends, which becomes the person's bubble */
  prompt: string
  /** the preset's palette with any picked colour overriding its token */
  tokens: DesignToken[]
  /** the `theme.radius` scale for the shape stop, or null when skipped */
  radius: Record<string, string> | null
  colorMode: 'light' | 'dark' | 'system' | null
  fonts: Pick<
    ProjectSettings['fonts'],
    'family' | 'serifFamily' | 'monoFamily' | 'googleFontsUrl'
  > | null
  locales: { codes: string[]; defaultLocale: string } | null
  /** *still* means do not offer animations afterwards — see the motion table */
  offerMotion: boolean
}

export const BRIEF_GOALS = [
  'sign up',
  'buy',
  'contact',
  'book',
  'read',
  'download',
  'just look',
] as const

export const BRIEF_PAGES = [
  'home',
  'about',
  'pricing',
  'blog',
  'contact',
  'coming soon',
  'FAQ',
  'team',
  'portfolio',
] as const

export const BRIEF_TONES = [
  'serious',
  'friendly',
  'playful',
  'luxurious',
  'technical',
  'bold',
] as const

export const BRIEF_IMAGERY = ['photos', 'illustrations', 'abstract shapes', 'none'] as const

/** the one place a token NAME appears, so a preset cannot miss one */
const PALETTE_KEYS = [
  'background',
  'foreground',
  'muted',
  'muted-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'input',
] as const

type PaletteKey = (typeof PALETTE_KEYS)[number]

export interface BriefPalette {
  name: string
  /** the swatches the tile shows, in order */
  swatch: string[]
  light: Record<PaletteKey, string>
  dark: Record<PaletteKey, string>
}

/**
 * Eight moods, each a complete palette in both modes.
 *
 * Hex, not oklch: `tokenError` takes `#hex` colour values and nothing else
 * (`src/lib/shared/tokens.js`), which is also what `ColorPickerUI` hands back,
 * so a preset and an override are the same kind of value.
 */
export const BRIEF_PALETTES: BriefPalette[] = [
  {
    name: 'colorful',
    swatch: ['#2563eb', '#f97316', '#10b981'],
    light: {
      background: '#ffffff',
      foreground: '#111827',
      muted: '#f3f4f6',
      'muted-foreground': '#6b7280',
      primary: '#2563eb',
      'primary-foreground': '#ffffff',
      secondary: '#10b981',
      'secondary-foreground': '#04291d',
      accent: '#f97316',
      'accent-foreground': '#2b1004',
      input: '#e5e7eb',
    },
    dark: {
      background: '#0b1020',
      foreground: '#f3f4f6',
      muted: '#1b2238',
      'muted-foreground': '#9aa4bf',
      primary: '#60a5fa',
      'primary-foreground': '#07122b',
      secondary: '#34d399',
      'secondary-foreground': '#04291d',
      accent: '#fb923c',
      'accent-foreground': '#2b1004',
      input: '#232c47',
    },
  },
  {
    name: 'monochrome',
    swatch: ['#1f2937', '#6b7280', '#e5e7eb'],
    light: {
      background: '#ffffff',
      foreground: '#111827',
      muted: '#f4f5f7',
      'muted-foreground': '#6b7280',
      primary: '#1f2937',
      'primary-foreground': '#ffffff',
      secondary: '#e5e7eb',
      'secondary-foreground': '#1f2937',
      accent: '#4b5563',
      'accent-foreground': '#ffffff',
      input: '#e5e7eb',
    },
    dark: {
      background: '#0f1115',
      foreground: '#f4f5f7',
      muted: '#1a1d24',
      'muted-foreground': '#9ca3af',
      primary: '#e5e7eb',
      'primary-foreground': '#0f1115',
      secondary: '#262a33',
      'secondary-foreground': '#e5e7eb',
      accent: '#9ca3af',
      'accent-foreground': '#0f1115',
      input: '#262a33',
    },
  },
  {
    name: 'black & white',
    swatch: ['#000000', '#ffffff', '#767676'],
    light: {
      background: '#ffffff',
      foreground: '#000000',
      muted: '#f2f2f2',
      'muted-foreground': '#595959',
      primary: '#000000',
      'primary-foreground': '#ffffff',
      secondary: '#f2f2f2',
      'secondary-foreground': '#000000',
      accent: '#000000',
      'accent-foreground': '#ffffff',
      input: '#d9d9d9',
    },
    dark: {
      background: '#000000',
      foreground: '#ffffff',
      muted: '#141414',
      'muted-foreground': '#a6a6a6',
      primary: '#ffffff',
      'primary-foreground': '#000000',
      secondary: '#1f1f1f',
      'secondary-foreground': '#ffffff',
      accent: '#ffffff',
      'accent-foreground': '#000000',
      input: '#262626',
    },
  },
  {
    name: 'pastel',
    swatch: ['#a5b4fc', '#fbcfe8', '#bbf7d0'],
    light: {
      background: '#fffdfb',
      foreground: '#2f2a3a',
      muted: '#f6f2fb',
      'muted-foreground': '#7b7290',
      primary: '#a5b4fc',
      'primary-foreground': '#1f2440',
      secondary: '#bbf7d0',
      'secondary-foreground': '#17352a',
      accent: '#fbcfe8',
      'accent-foreground': '#3f1f33',
      input: '#ece6f5',
    },
    dark: {
      background: '#1b1825',
      foreground: '#f3eefb',
      muted: '#262134',
      'muted-foreground': '#a79fbd',
      primary: '#b4c0ff',
      'primary-foreground': '#1f2440',
      secondary: '#9fe6bd',
      'secondary-foreground': '#17352a',
      accent: '#f3bcda',
      'accent-foreground': '#3f1f33',
      input: '#302942',
    },
  },
  {
    name: 'dark',
    swatch: ['#0a0a0a', '#e4e4e7', '#22d3ee'],
    light: {
      background: '#18181b',
      foreground: '#fafafa',
      muted: '#27272a',
      'muted-foreground': '#a1a1aa',
      primary: '#22d3ee',
      'primary-foreground': '#042f36',
      secondary: '#27272a',
      'secondary-foreground': '#fafafa',
      accent: '#a78bfa',
      'accent-foreground': '#1e1335',
      input: '#3f3f46',
    },
    dark: {
      background: '#09090b',
      foreground: '#fafafa',
      muted: '#18181b',
      'muted-foreground': '#8b8b95',
      primary: '#22d3ee',
      'primary-foreground': '#042f36',
      secondary: '#1c1c20',
      'secondary-foreground': '#fafafa',
      accent: '#a78bfa',
      'accent-foreground': '#1e1335',
      input: '#2a2a30',
    },
  },
  {
    name: 'earthy',
    swatch: ['#7c5e3b', '#a3b18a', '#e8e0d4'],
    light: {
      background: '#fbf8f3',
      foreground: '#2e2a24',
      muted: '#f0ebe1',
      'muted-foreground': '#7a7064',
      primary: '#7c5e3b',
      'primary-foreground': '#fbf8f3',
      secondary: '#a3b18a',
      'secondary-foreground': '#23291b',
      accent: '#c9774e',
      'accent-foreground': '#fbf8f3',
      input: '#e3dacb',
    },
    dark: {
      background: '#1a1713',
      foreground: '#f0ebe1',
      muted: '#262118',
      'muted-foreground': '#a89c8a',
      primary: '#c49a6c',
      'primary-foreground': '#241a0f',
      secondary: '#8c9a74',
      'secondary-foreground': '#23291b',
      accent: '#e0906a',
      'accent-foreground': '#2b150a',
      input: '#332c22',
    },
  },
  {
    name: 'warm',
    swatch: ['#dc2626', '#f59e0b', '#fff7ed'],
    light: {
      background: '#fffbf7',
      foreground: '#2b1b14',
      muted: '#fdf0e4',
      'muted-foreground': '#8a6a56',
      primary: '#dc2626',
      'primary-foreground': '#fffbf7',
      secondary: '#f59e0b',
      'secondary-foreground': '#2e1f03',
      accent: '#ea580c',
      'accent-foreground': '#fffbf7',
      input: '#f6e2d1',
    },
    dark: {
      background: '#1c1209',
      foreground: '#fdf0e4',
      muted: '#2a1b10',
      'muted-foreground': '#b79a86',
      primary: '#f87171',
      'primary-foreground': '#2d0a0a',
      secondary: '#fbbf24',
      'secondary-foreground': '#2e1f03',
      accent: '#fb923c',
      'accent-foreground': '#2b1004',
      input: '#382516',
    },
  },
  {
    name: 'cool',
    swatch: ['#0ea5e9', '#6366f1', '#f0f9ff'],
    light: {
      background: '#f8fbff',
      foreground: '#0f1b2d',
      muted: '#eaf3fb',
      'muted-foreground': '#5b7288',
      primary: '#0ea5e9',
      'primary-foreground': '#04212e',
      secondary: '#6366f1',
      'secondary-foreground': '#f8fbff',
      accent: '#06b6d4',
      'accent-foreground': '#04232a',
      input: '#d8e7f4',
    },
    dark: {
      background: '#070e18',
      foreground: '#eaf3fb',
      muted: '#101b2a',
      'muted-foreground': '#8ba3bb',
      primary: '#38bdf8',
      'primary-foreground': '#04212e',
      secondary: '#818cf8',
      'secondary-foreground': '#101433',
      accent: '#22d3ee',
      'accent-foreground': '#04232a',
      input: '#19263a',
    },
  },
]

/**
 * The shape stops, as the plan names them, and the radius SCALE each writes.
 *
 * `theme.radius` is a scale rather than one number — Tailwind reads
 * `--radius-lg` for `rounded-lg` — so the stop's named value anchors `lg` and
 * the rest follows it. Writing only one key would leave every other `rounded-*`
 * class on the framework default, which is the one outcome the brief is for.
 */
export const BRIEF_SHAPES: { name: string; anchor: string; radius: Record<string, string> }[] = [
  {
    name: 'not rounded',
    anchor: '0',
    radius: { sm: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0' },
  },
  {
    name: 'rounded',
    anchor: '0.5rem',
    radius: {
      sm: '0.25rem',
      md: '0.375rem',
      lg: '0.5rem',
      xl: '0.75rem',
      '2xl': '1rem',
      '3xl': '1.5rem',
    },
  },
  {
    name: 'very rounded',
    anchor: '1rem',
    radius: {
      sm: '0.5rem',
      md: '0.75rem',
      lg: '1rem',
      xl: '1.5rem',
      '2xl': '2rem',
      '3xl': '2.5rem',
    },
  },
  {
    name: 'bubbly',
    anchor: '2rem',
    radius: {
      sm: '1rem',
      md: '1.5rem',
      lg: '2rem',
      xl: '2.5rem',
      '2xl': '3rem',
      '3xl': '9999px',
    },
  },
]

/**
 * Grid and motion are SENTENCES, not settings: there is nothing in
 * `ProjectSettings` that holds "playful". The model gets the word and a line
 * saying what it means, from a fixed table, so two briefs on the same stop ask
 * for the same thing.
 */
export const BRIEF_GRIDS: { name: string; sentence: string }[] = [
  {
    name: 'structured',
    sentence:
      'Keep every section on one grid: equal columns, consistent gutters, nothing breaking the ' +
      'alignment.',
  },
  {
    name: 'loose',
    sentence:
      'One grid, but let sections breathe: vary the column counts and the vertical rhythm ' +
      'between them.',
  },
  {
    name: 'playful',
    sentence:
      'Break the grid on purpose in a few places — an offset image, an asymmetric two-column ' +
      'split, one element overlapping another.',
  },
  {
    name: 'wild',
    sentence:
      'Treat the grid as a suggestion: overlapping blocks, deliberate asymmetry, elements that ' +
      'run off the edge. It should look composed, not tidy.',
  },
]

export const BRIEF_MOTIONS: { name: string; sentence: string; offer: boolean }[] = [
  {
    name: 'still',
    sentence: 'No animation at all. Do not add load or scroll animations, and do not offer them.',
    offer: false,
  },
  {
    name: 'subtle',
    sentence: 'Motion only where it helps: a short fade-and-rise on the hero, nothing else.',
    offer: true,
  },
  {
    name: 'lively',
    sentence:
      'Animate the main sections in as they are scrolled to, staggered over their children ' +
      'rather than over the container.',
    offer: true,
  },
  {
    name: 'showy',
    sentence:
      'Motion is part of the design: staggered entrances, a parallax or mouse-follow accent, ' +
      'hover states that move.',
    offer: true,
  },
]

/**
 * One Google Fonts pairing per direction, fixed.
 *
 * The URL is a single `css2` request for both families, because every extra
 * stylesheet is another blocking request on the published page.
 */
export const BRIEF_FONTS: {
  name: string
  family: string
  serifFamily?: string
  monoFamily?: string
  googleFontsUrl: string
}[] = [
  {
    name: 'sans',
    family: 'Inter',
    serifFamily: 'Lora',
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Lora:wght@400;600&display=swap',
  },
  {
    name: 'serif',
    family: 'Source Sans 3',
    serifFamily: 'Playfair Display',
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@400;600&display=swap',
  },
  {
    name: 'mono',
    family: 'IBM Plex Sans',
    monoFamily: 'IBM Plex Mono',
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;600&display=swap',
  },
  {
    name: 'display',
    family: 'Work Sans',
    serifFamily: 'Fraunces',
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Fraunces:wght@500;700;900&family=Work+Sans:wght@400;600&display=swap',
  },
]

const stop = <T>(table: T[], index: number | undefined): T | null =>
  typeof index === 'number' && index >= 0 && index < table.length ? table[index]! : null

const clean = (value: string | undefined): string => (value ?? '').trim()

const list = (values: string[] | undefined): string[] =>
  (values ?? []).map(clean).filter(Boolean)

export const paletteNamed = (name: string | undefined): BriefPalette | null =>
  BRIEF_PALETTES.find((p) => p.name === name) ?? null

export const fontNamed = (name: string | undefined): (typeof BRIEF_FONTS)[number] | null =>
  BRIEF_FONTS.find((f) => f.name === name) ?? null

/**
 * The preset's palette as project tokens, with a picked colour overriding its
 * token in BOTH modes — a brand colour is one colour, which is also why
 * `DesignToken.dark` is optional.
 */
function paletteTokens(palette: BriefPalette, colors: BriefColors | undefined): DesignToken[] {
  const override: Partial<Record<PaletteKey, string>> = {}
  if (clean(colors?.primary)) override.primary = clean(colors?.primary)
  if (clean(colors?.accent)) override.accent = clean(colors?.accent)
  if (clean(colors?.background)) override.background = clean(colors?.background)
  return PALETTE_KEYS.map((name) => {
    const picked = override[name]
    return picked
      ? { id: uid(), name, value: picked }
      : { id: uid(), name, value: palette.light[name], dark: palette.dark[name] }
  })
}

/**
 * The compiled brief: one fixed template, sections in the intake's order, and
 * a skipped screen simply absent. Nothing is invented to fill a gap — a brief
 * answered on two screens is a valid brief.
 */
export function compileBrief(answers: BriefAnswers): CompiledBrief {
  const palette = paletteNamed(answers.palette)
  const shape = stop(BRIEF_SHAPES, answers.shape)
  const grid = stop(BRIEF_GRIDS, answers.grid)
  const motion = stop(BRIEF_MOTIONS, answers.motion)
  const font = fontNamed(answers.font)
  const locales = list(answers.locales)

  const lines: string[] = ['# Brief', '']

  const subject = clean(answers.subject)
  const audience = clean(answers.audience)
  if (subject) lines.push(`**What it is:** ${subject}`)
  if (audience) lines.push(`**Who it is for:** ${audience}`)

  const goal = clean(answers.goal)
  if (goal) {
    lines.push(
      `**What a visitor should do:** ${goal} — this decides the hero and the call to action.`,
    )
  }

  const pages = list(answers.pages)
  if (pages.length) lines.push(`**Pages or sections:** ${pages.join(', ')}`)

  const tone = list(answers.tone)
  if (tone.length) lines.push(`**Tone:** ${tone.join(', ')}`)

  if (palette) lines.push(`**Palette:** ${palette.name} (already written into the tokens)`)
  if (shape) lines.push(`**Shape:** ${shape.name} (the radius scale is already set)`)
  if (grid) lines.push(`**Grid:** ${grid.name} — ${grid.sentence}`)
  if (motion) lines.push(`**Motion:** ${motion.name} — ${motion.sentence}`)
  if (font) lines.push(`**Type:** ${font.name} — ${font.family} is already set as the font`)

  const imagery = list(answers.imagery)
  if (imagery.length) lines.push(`**Imagery:** ${imagery.join(', ')}`)

  if (locales.length > 1) {
    lines.push(
      `**Languages:** ${locales.join(', ')} (${locales[0]} is the default; the locales are ` +
        'already added, so write content that can be translated)',
    )
  }

  const logo = clean(answers.logoPath)
  const brandFonts = clean(answers.brandFonts)
  if (logo) lines.push(`**Logo:** already in the media library at \`${logo}\` — use it.`)
  if (brandFonts) lines.push(`**Brand fonts:** ${brandFonts}`)

  const references = (answers.references ?? []).filter((r) => clean(r.url) || clean(r.name))
  if (references.length) {
    const named = references
      .map((r) => (clean(r.url) ? `${clean(r.url)}` : clean(r.name)))
      .filter(Boolean)
    lines.push(
      `**Inspired by:** ${named.join(', ')} — the screenshots attached to this message are what ` +
        'to go by; I know you cannot open a link.',
    )
  }

  const law = clean(answers.law)
  if (law) {
    lines.push('', '## Must use, must not invent', '', law)
  }

  lines.push(
    '',
    'The palette, radius, colour mode, fonts and locales are already set in the project — ' +
      'build on them, do not replace them. Anything not stated here, ask me before inventing it.',
  )

  return {
    prompt: lines.join('\n'),
    tokens: palette ? paletteTokens(palette, answers.colors) : [],
    radius: shape ? shape.radius : null,
    colorMode: answers.colorMode ?? null,
    fonts: font
      ? {
          family: font.family,
          ...(font.serifFamily ? { serifFamily: font.serifFamily } : {}),
          ...(font.monoFamily ? { monoFamily: font.monoFamily } : {}),
          googleFontsUrl: font.googleFontsUrl,
        }
      : null,
    locales: locales.length > 1 ? { codes: locales, defaultLocale: locales[0]! } : null,
    offerMotion: motion ? motion.offer : true,
  }
}
