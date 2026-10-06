import { computed, ref, watch } from 'vue'
import { useProject } from './useProject'
import { walkNodes } from '@/lib/tree'
import { purgeLocaleSeo } from '@/lib/shared/locales.js'
import type { CollectionEntry, ElementNode } from '@/types/editor'

/** the locale being edited/previewed — runtime editor state, shared
 * across pages; deliberately NOT on the project (not persisted, not
 * part of undo history) */
const activeLocale = ref('en')

const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/

let clampStarted = false

export interface LocalizedValue {
  value: string | undefined
  /** false = shown via default-locale fallback while a non-default locale is active */
  translated: boolean
}

export function useLocale() {
  const { project } = useProject()

  const locales = computed(() => project.value.locales)
  const defaultLocale = computed(() => project.value.defaultLocale)
  const isDefault = computed(() => activeLocale.value === defaultLocale.value)

  // branch switch / undo / reset may load a project without the active locale
  if (!clampStarted) {
    clampStarted = true
    watch(locales, (list) => {
      if (!list.includes(activeLocale.value)) activeLocale.value = defaultLocale.value
    })
  }

  function normalizeLocale(raw: string): string | null {
    const code = raw.trim().toLowerCase()
    return LOCALE_RE.test(code) ? code : null
  }

  function addLocale(raw: string): string | null {
    const code = normalizeLocale(raw)
    if (!code || locales.value.includes(code)) return null
    project.value.locales.push(code) // undoable: lives on the project
    return code
  }

  function setActiveLocale(code: string) {
    activeLocale.value = locales.value.includes(code) ? code : defaultLocale.value
  }

  /**
   * Hard-deletes a locale AND all its translation overrides across the project
   * (page elements, component masters, collection entries). The default locale
   * holds the base content, so it can never be deleted. One mutation → undoable.
   */
  function deleteLocale(code: string) {
    if (code === defaultLocale.value) return
    project.value.locales = project.value.locales.filter((l) => l !== code)
    const purge = (node: ElementNode) => {
      if (!node.locales?.[code]) return
      delete node.locales[code]
      if (!Object.keys(node.locales).length) delete node.locales
    }
    for (const page of project.value.pages) walkNodes(page.elements, purge)
    for (const comp of project.value.components) walkNodes([comp.root], purge)
    for (const collection of project.value.collections) {
      for (const entry of collection.entries) {
        if (!entry.locales?.[code]) continue
        delete entry.locales[code]
        if (!Object.keys(entry.locales).length) delete entry.locales
      }
    }
    // per-locale SEO lives outside the node/entry `locales` buckets — page
    // overrides and the project defaults. Left behind, they are orphaned
    // strings for a locale that no longer renders, and nothing in the UI can
    // reach them to clean up.
    purgeLocaleSeo(project.value, code)
  }

  /**
   * Changes which locale the base content belongs to. Content does NOT move
   * between locales — this says what language the base text is already in.
   */
  function setDefaultLocale(code: string) {
    if (!locales.value.includes(code) || code === defaultLocale.value) return
    project.value.defaultLocale = code
  }

  // --- canvas reads (fallback-aware) ---

  function nodeContent(node: ElementNode): LocalizedValue {
    if (isDefault.value) return { value: node.content, translated: true }
    const override = node.locales?.[activeLocale.value]?.content
    return override
      ? { value: override, translated: true }
      : { value: node.content, translated: false }
  }

  /**
   * The active locale's ATTRIBUTE overrides for a node, or undefined on the
   * default locale. Unlike content there is no fallback marker: an absent or
   * empty override simply leaves the base attribute in place
   * (mergeAttributeLayers ignores it).
   */
  function localeAttributes(node: ElementNode): Record<string, string> | undefined {
    if (isDefault.value) return undefined
    return node.locales?.[activeLocale.value]?.attributes
  }

  /** write one attribute's translation; '' deletes the override */
  function setNodeAttribute(node: ElementNode, name: string, value: string) {
    if (isDefault.value) {
      const attrs = { ...(node.attributes ?? {}) }
      if (value) attrs[name] = value
      else delete attrs[name]
      if (Object.keys(attrs).length) node.attributes = attrs
      else delete node.attributes
      return
    }
    const pack = { ...(node.locales?.[activeLocale.value] ?? {}) }
    const attrs = { ...(pack.attributes ?? {}) }
    if (value) attrs[name] = value
    else delete attrs[name]
    if (Object.keys(attrs).length) pack.attributes = attrs
    else delete pack.attributes
    // prune an empty pack so touch-then-clear leaves the node byte-identical
    const locales = { ...(node.locales ?? {}) }
    if (Object.keys(pack).length) locales[activeLocale.value] = pack
    else delete locales[activeLocale.value]
    if (Object.keys(locales).length) node.locales = locales
    else delete node.locales
  }

  function nodeSrc(node: ElementNode): LocalizedValue {
    if (isDefault.value) return { value: node.src, translated: true }
    const override = node.locales?.[activeLocale.value]?.src
    return override
      ? { value: override, translated: true }
      : { value: node.src, translated: false }
  }

  // reference fields store ids (possibly arrays) — those never read as text
  function baseEntryText(entry: CollectionEntry, field: string): string | undefined {
    const raw = entry.values[field]
    return typeof raw === 'string' ? raw : undefined
  }

  // accepts the field object where the caller has it: a field flagged
  // localize:false always reads its base value (never a stale stored
  // override), matching the exporter's entryValue
  function entryValue(
    entry: CollectionEntry,
    field: string | { name: string; localize?: boolean },
  ): LocalizedValue {
    const name = typeof field === 'string' ? field : field.name
    const localizable = typeof field === 'string' || field.localize !== false
    if (isDefault.value || !localizable) {
      return { value: baseEntryText(entry, name), translated: true }
    }
    const override = entry.locales?.[activeLocale.value]?.[name]
    return override
      ? { value: override, translated: true }
      : { value: baseEntryText(entry, name), translated: false }
  }

  // --- panel edits (raw override, no fallback) ---

  function editNodeContent(node: ElementNode): string {
    return (isDefault.value ? node.content : node.locales?.[activeLocale.value]?.content) ?? ''
  }

  function setNodeContent(node: ElementNode, value: string) {
    if (isDefault.value) node.content = value
    else setNodeOverride(node, 'content', value)
  }

  function editNodeSrc(node: ElementNode): string {
    return (isDefault.value ? node.src : node.locales?.[activeLocale.value]?.src) ?? ''
  }

  function setNodeSrc(node: ElementNode, value: string) {
    if (isDefault.value) node.src = value || undefined
    else setNodeOverride(node, 'src', value)
  }

  // an empty value deletes the override (fallback returns); empty
  // records are pruned so a touch-then-clear edit leaves the node
  // byte-identical — keeps branch-merge signatures stable
  function setNodeOverride(node: ElementNode, key: 'content' | 'src', value: string) {
    if (!value) {
      const slot = node.locales?.[activeLocale.value]
      if (slot) {
        delete slot[key]
        if (!Object.keys(slot).length) delete node.locales![activeLocale.value]
        if (!Object.keys(node.locales!).length) delete node.locales
      }
      return
    }
    ;((node.locales ??= {})[activeLocale.value] ??= {})[key] = value
  }

  function editEntryValue(entry: CollectionEntry, field: string): string {
    return (
      (isDefault.value
        ? baseEntryText(entry, field)
        : entry.locales?.[activeLocale.value]?.[field]) ?? ''
    )
  }

  function setEntryValue(entry: CollectionEntry, field: string, value: string) {
    if (isDefault.value) {
      entry.values[field] = value
      return
    }
    if (!value) {
      const slot = entry.locales?.[activeLocale.value]
      if (slot) {
        delete slot[field]
        if (!Object.keys(slot).length) delete entry.locales![activeLocale.value]
        if (!Object.keys(entry.locales!).length) delete entry.locales
      }
      return
    }
    ;((entry.locales ??= {})[activeLocale.value] ??= {})[field] = value
  }

  return {
    activeLocale,
    locales,
    defaultLocale,
    isDefault,
    addLocale,
    setActiveLocale,
    deleteLocale,
    setDefaultLocale,
    nodeContent,
    nodeSrc,
    localeAttributes,
    setNodeAttribute,
    entryValue,
    editNodeContent,
    setNodeContent,
    editNodeSrc,
    setNodeSrc,
    editEntryValue,
    setEntryValue,
  }
}
