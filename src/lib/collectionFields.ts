import type { Collection, CollectionField } from '@/types/editor'

export const FIELD_TYPES: { label: string; value: CollectionField['type'] }[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Yes / no', value: 'boolean' },
  { label: 'Choice', value: 'select' },
  { label: 'Image', value: 'image' },
  { label: 'Date', value: 'date' },
  { label: 'Reference', value: 'reference' },
  { label: 'Multi-ref', value: 'multi-reference' },
  { label: 'Gallery', value: 'multi-image' },
]

export const isRefType = (t: string) => t === 'reference' || t === 'multi-reference'

export const isTranslatableType = (t: string) => t === 'text'

export const RESERVED_FIELD_NAMES = ['name', 'slug']

export function fieldNameError(name: string): string | null {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'a field needs a name'
  if (RESERVED_FIELD_NAMES.includes(trimmed.toLowerCase())) {
    return (
      `"${trimmed}" is an entry's OWN property (${RESERVED_FIELD_NAMES.join(', ')}), set at the ` +
      'top level of an upsert_entries item — a FIELD by that name would be a second value with ' +
      'the same name, and every route and @item link would use the other one. Pick another name'
    )
  }
  return null
}

export function fieldValueError(field: CollectionField, value: string): string | null {
  if (value === '') return null
  if (field.type === 'number') {
    return Number.isFinite(Number(value)) ? null : `"${value}" is not a number`
  }
  if (field.type === 'boolean') {
    return value === 'true' || value === 'false' ? null : `"${value}" is not "true" or "false"`
  }
  if (field.type === 'select') {
    const options = field.options ?? []
    if (!options.length) return `"${field.name}" has no options yet — add them to the field first`
    return options.includes(value)
      ? null
      : `"${value}" is not one of ${options.map((o) => `"${o}"`).join(', ')}`
  }
  return null
}

export function setFieldType(
  field: CollectionField,
  type: CollectionField['type'],
  collections: Collection[],
) {
  field.type = type
  if (isRefType(type)) field.refCollectionId ??= collections[0]?.id
  else delete field.refCollectionId
  if (type !== 'select' || !field.options?.length) delete field.options
}
