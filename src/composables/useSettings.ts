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
  const effectiveTokens = validTokens

  if (!syncStarted) {
    syncStarted = true
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

  function ensureTokens(wanted: DesignToken[]): string[] {
    const have = new Set(settings.value.tokens.map((t) => t.name))
    const missing = wanted.filter((t) => !have.has(t.name) && !tokenError(t))
    if (missing.length) settings.value.tokens.push(...missing)
    return missing.map((t) => t.name)
  }

  const motion = computed<NonNullable<ProjectSettings['motion']>>(
    () => (settings.value.motion ??= {}),
  )

  const transitions = computed<NonNullable<NonNullable<ProjectSettings['motion']>['transitions']>>(
    () => (motion.value.transitions ??= { enabled: false }),
  )

  const smoothScroll = computed<NonNullable<NonNullable<ProjectSettings['motion']>['scroll']>>(
    () => (motion.value.scroll ??= { enabled: false }),
  )

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

  const legacyHeadFonts = computed(() => {
    const registered = new Set(
      customFonts.value.map((f) => `${f.family.trim().toLowerCase()}|${f.weight ?? ''}|${f.style ?? ''}`),
    )
    return parseFontFaces(settings.value.customCode?.head ?? '').filter(
      (f) => !registered.has(`${f.family.trim().toLowerCase()}|${f.weight ?? ''}|${f.style ?? ''}`),
    )
  })

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
