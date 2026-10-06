import { computed, type WritableComputedRef } from 'vue'
import { useLocale } from './useLocale'
import { refIds, mediaUrls } from '@/lib/shared/fields.js'
import type { CollectionEntry, CollectionField } from '@/types/editor'

/**
 * Read/write primitives for ONE collection-entry field, per field type.
 *
 * The ONE implementation. Two surfaces call it: the Pages drawer's entry
 * editor (`EntryFieldControl.vue`), with the field it is rendering, and the
 * Data panel (`DataEditor.vue`), with the field the selected element is bound
 * to. The panel used to carry its own copy of the reference and gallery
 * writers, with a comment asking the next person to keep two sets of rules in
 * step — and the rules below are exactly the ones a drifted copy would break
 * invisibly, as a phantom change in a draft diff.
 *
 * The invariants, which exist so an entry that was touched and cleared stays
 * byte-identical to one that never held a value (branch-merge signatures):
 *   1. an emptied list DELETES the key rather than storing `[]`
 *   2. clearing a gallery slot SPLICES it out — a gallery never holds holes
 *
 * Text-ish fields (text/date/image) are locale-aware and go through
 * useLocale's editEntryValue/setEntryValue, which prune overrides the same
 * way. Reference fields store ids and are NEVER locale-overridden, so they
 * write `entry.values` directly.
 *
 * Stateless by design: no module-level refs, so it is safe to call per field.
 */
export function useEntryField() {
  const { isDefault, entryValue, editEntryValue, setEntryValue } = useLocale()

  /**
   * Two-way model for a text/date/image value, locale-aware.
   * Takes GETTERS so the model tracks a component's props: the entry object is
   * re-derived from ids on every render (undo/branch-switch replaces the whole
   * project), and a model closed over a stale object would write into a
   * detached copy.
   */
  function textModel(
    getEntry: () => CollectionEntry,
    getField: () => CollectionField,
  ): WritableComputedRef<string> {
    return computed({
      get: () => editEntryValue(getEntry(), getField().name),
      set: (value: string) => setEntryValue(getEntry(), getField().name, value),
    })
  }

  /** the default-locale value, for showing as a fallback while translating.
   *  Takes the FIELD (not its name) so a localize:false field reads base. */
  function fallbackText(entry: CollectionEntry, field: CollectionField): string {
    return entryValue(entry, field).value ?? ''
  }

  /**
   * True when this field must not be edited under the active locale: the MCP
   * server refuses a non-empty override on a localize:false field, so the
   * client must not mint one either (it would be an orphan nothing reads).
   */
  function lockedInLocale(field: CollectionField): boolean {
    return !isDefault.value && field.localize === false
  }

  /** single reference — base values only */
  function readRef(entry: CollectionEntry, field: CollectionField): string {
    const v = entry.values[field.name]
    return typeof v === 'string' ? v : ''
  }

  function setRef(entry: CollectionEntry, field: CollectionField, id: string) {
    if (id) entry.values[field.name] = id
    else delete entry.values[field.name]
  }

  /** multi-reference — toggled id list, order = toggle order */
  function toggleRef(entry: CollectionEntry, field: CollectionField, id: string) {
    const ids = refIds(entry, field.name)
    writeList(entry, field, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  /** multi-image / multi-reference — the whole list; empty drops the key */
  function writeList(entry: CollectionEntry, field: CollectionField, next: string[]) {
    const clean = next.filter(Boolean)
    if (clean.length) entry.values[field.name] = clean
    else delete entry.values[field.name]
  }

  /** clearing a slot REMOVES it — a gallery never holds empty holes, which is
   *  the whole reason this type exists instead of numbered image fields */
  function setListAt(entry: CollectionEntry, field: CollectionField, index: number, url: string) {
    const next = [...mediaUrls(entry, field.name)]
    if (url) next[index] = url
    else next.splice(index, 1)
    writeList(entry, field, next)
  }

  function moveInList(
    entry: CollectionEntry,
    field: CollectionField,
    index: number,
    delta: -1 | 1,
  ) {
    const next = [...mediaUrls(entry, field.name)]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to]!, next[index]!]
    writeList(entry, field, next)
  }

  return {
    isDefault,
    textModel,
    fallbackText,
    lockedInLocale,
    readRef,
    setRef,
    toggleRef,
    writeList,
    setListAt,
    moveInList,
    refIds,
    mediaUrls,
  }
}
