import { computed, type WritableComputedRef } from 'vue'
import { useLocale } from './useLocale'
import { refIds, mediaUrls } from '@/lib/shared/fields.js'
import type { CollectionEntry, CollectionField } from '@/types/editor'

export function useEntryField() {
  const { isDefault, entryValue, editEntryValue, setEntryValue } = useLocale()

  function textModel(
    getEntry: () => CollectionEntry,
    getField: () => CollectionField,
  ): WritableComputedRef<string> {
    return computed({
      get: () => editEntryValue(getEntry(), getField().name),
      set: (value: string) => setEntryValue(getEntry(), getField().name, value),
    })
  }

  function fallbackText(entry: CollectionEntry, field: CollectionField): string {
    return entryValue(entry, field).value ?? ''
  }

  function lockedInLocale(field: CollectionField): boolean {
    return !isDefault.value && field.localize === false
  }

  function readRef(entry: CollectionEntry, field: CollectionField): string {
    const v = entry.values[field.name]
    return typeof v === 'string' ? v : ''
  }

  function setRef(entry: CollectionEntry, field: CollectionField, id: string) {
    if (id) entry.values[field.name] = id
    else delete entry.values[field.name]
  }

  function toggleRef(entry: CollectionEntry, field: CollectionField, id: string) {
    const ids = refIds(entry, field.name)
    writeList(entry, field, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  function writeList(entry: CollectionEntry, field: CollectionField, next: string[]) {
    const clean = next.filter(Boolean)
    if (clean.length) entry.values[field.name] = clean
    else delete entry.values[field.name]
  }

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
