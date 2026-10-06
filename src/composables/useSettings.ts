import { computed, effectScope, watchEffect } from 'vue'
import { useProject } from './useProject'
import {
  isEmittableToken,
  parseFontFaces,
  stripFontFaces,
  fontFormatForUrl,
  tokenError,
} from '@/lib/settings'
import { setColorTokens } from '@/lib/colors'
import { setStyleTokens } from '@/lib/styles'
import type { CustomFont, DesignToken, ProjectSettings } from '@/types/editor'
import { uid } from '@/lib/shared/ids.js'

let syncStarted = false

export function useSettings() {
  const { project } = useProject()

  const settings = computed(() => project.value.settings)
  const validTokens = computed(() => settings.value.tokens.filter(isEmittableToken))
  /** what the editor renders and validates against */
  const effectiveTokens = validTokens

  // keep the (non-reactive) style/color vocabularies aware of tokens so
  // bg-brand suggests, validates, and resolves to its hex everywhere
  if (!syncStarted) {
    syncStarted = true
    // detached, so it outlives whichever component happened to call first
    effectScope(true).run(() => {
      watchEffect(() => {
        setColorTokens(Object.fromEntries(effectiveTokens.value.map((t) => [t.name, t.value])))
        setStyleTokens(effectiveTokens.value.map((t) => t.name))
      })
    })
  }

  function addToken(): DesignToken {
    const token: DesignToken = { id: uid(), name: '', value: '#3b82f6' }
    settings.value.tokens.push(token)
    return token
  }

  function removeToken(id: string) {
    settings.value.tokens = settings.value.tokens.filter((t) => t.id !== id)
  }

  /**
   * Adds any of these tokens the project doesn't have yet, and returns the
   * names actually created. An existing token is never touched — a library
   * component must adopt the project's palette, not overwrite it.
   *
   * Pushed in one go: every token change triggers a full Tailwind recompile
   * (debounced, but still), so a per-token loop would pay for it repeatedly.
   */
  function ensureTokens(wanted: DesignToken[]): string[] {
    const have = new Set(settings.value.tokens.map((t) => t.name))
    const missing = wanted.filter((t) => !have.has(t.name) && !tokenError(t))
    if (missing.length) settings.value.tokens.push(...missing)
    return missing.map((t) => t.name)
  }

  // --- site-wide motion ---
  // `settings.motion` is optional (absent = everything off), so materialize it
  // and its two sub-objects on first read rather than making every control
  // guard against undefined. Writing them costs nothing: the defaults below are
  // exactly what an absent key already means.

  const motion = computed<NonNullable<ProjectSettings['motion']>>(
    () => (settings.value.motion ??= {}),
  )

  const transitions = computed<NonNullable<NonNullable<ProjectSettings['motion']>['transitions']>>(
    () => (motion.value.transitions ??= { enabled: false }),
  )

  const smoothScroll = computed<NonNullable<NonNullable<ProjectSettings['motion']>['scroll']>>(
    () => (motion.value.scroll ??= { enabled: false }),
  )

  // --- custom webfonts ---

  const customFonts = computed<CustomFont[]>({
    get: () => (settings.value.fonts.custom ??= []),
    set: (list) => (settings.value.fonts.custom = list),
  })

  function addFont(font: Partial<CustomFont> = {}): CustomFont {
    const entry: CustomFont = {
      id: uid(),
      family: font.family ?? '',
      src: font.src ?? '',
      format: font.format,
      weight: font.weight,
      style: font.style,
    }
    customFonts.value.push(entry)
    return entry
  }

  function removeFont(id: string) {
    settings.value.fonts.custom = customFonts.value.filter((f) => f.id !== id)
  }

  /**
   * @font-face rules hand-written into the custom head code — the pattern the
   * old docs recommended, which renders on the published site but NOT in the
   * editor or preview (customCode.head is exporter-only). Surfaced so the user
   * can convert them into real font entries in one click.
   * Rules whose family is already registered are not offered again.
   */
  const legacyHeadFonts = computed(() => {
    const registered = new Set(
      customFonts.value.map((f) => `${f.family.trim().toLowerCase()}|${f.weight ?? ''}|${f.style ?? ''}`),
    )
    return parseFontFaces(settings.value.customCode?.head ?? '').filter(
      (f) => !registered.has(`${f.family.trim().toLowerCase()}|${f.weight ?? ''}|${f.style ?? ''}`),
    )
  })

  /** convert the detected head-code rules into font entries. The head code is
   *  NOT touched — clearing it is a separate, explicit step, so a failed import
   *  can never leave the site with no fonts at all. */
  function importLegacyHeadFonts(): number {
    const found = legacyHeadFonts.value
    for (const f of found) {
      addFont({
        family: f.family,
        src: f.src,
        format: f.format ?? fontFormatForUrl(f.src),
        weight: f.weight,
        style: f.style === 'italic' ? 'italic' : undefined,
      })
    }
    return found.length
  }

  /** remove the now-redundant @font-face rules from the head code */
  function clearLegacyHeadFonts() {
    settings.value.customCode.head = stripFontFaces(settings.value.customCode?.head ?? '')
  }

  return {
    settings,
    motion,
    transitions,
    smoothScroll,
    validTokens,
    effectiveTokens,
    addToken,
    removeToken,
    ensureTokens,
    customFonts,
    addFont,
    removeFont,
    legacyHeadFonts,
    importLegacyHeadFonts,
    clearLegacyHeadFonts,
  }
}
