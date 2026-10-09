<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, Inbox, Plus, X } from 'lucide-vue-next'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import RichTextInput from '@/components/editor/content/RichTextInput.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import IconPickerControl from '@/components/editor/content/IconPickerControl.vue'
import { ELEMENTS, typeOptionsFor } from '@/lib/elements'
import { hasAncestorOfType, walkNodes } from '@/lib/tree'
import { setInstancePick } from '@/lib/variantOps'
import { sanitizeAttributes, isAllowedAttribute, mergeAttributeLayers } from '@/lib/shared/attributes.js'
import { useElement } from '@/composables/useElement'
import { useStructure } from '@/composables/useStructure'
import { FIELD_TYPES, isRefType, setFieldType } from '@/lib/collectionFields'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useLocale } from '@/composables/useLocale'
import { resolveBinding, refIds, mediaUrls } from '@/lib/shared/fields.js'
import { resolveSliderConfig, SLIDER_DEFAULTS } from '@/lib/shared/slider.js'
import { collectFormFields, formConfigError } from '@/lib/shared/forms.js'
import { useEntryField } from '@/composables/useEntryField'
import { isNodeHidden, resolveInstanceValue } from '@/lib/instances'
import { isComponentType } from '@/lib/components'
import { useProject } from '@/composables/useProject'
import { useSettings } from '@/composables/useSettings'
import { useAuth } from '@/composables/useAuth'
import { useModal } from '@/composables/useModal'
import { useComponents } from '@/composables/useComponents'
import { useComponentBoard } from '@/composables/useComponentBoard'
import { acceptsChildren } from '@/lib/treeOps'
import { pushMasterStructure } from '@/lib/componentOps'
import type { CollectionEntry, CollectionField, ElementNode } from '@/types/editor'

const FormSubmissionsModal = defineAsyncComponent(() => import('@/components/editor/forms/FormSubmissionsModal.vue'))

const { selectedElement, getElement, setElementChannel } = useElement()
const { backend } = useStructure()
const changeElementType = (id: string, type: string) => backend.value.retype(id, type)
const setElementArg = (id: string, arg: string | null) => backend.value.setArg(id, arg)
const setElementLink = (id: string, link: string | null) => backend.value.setLink(id, link)
const { masterFor, editTarget } = useComponents()
const { activePage, pages } = usePage()
const { breakpoints } = useProject()
const { settings } = useSettings()
const {
  collections,
  collectionById,
  collectionByName,
  activeCollection,
  activeEntry,
  addField,
  removeField,
} = useCollections()
const { isDefault, editNodeContent, setNodeContent, editNodeSrc, setNodeSrc, editEntryValue, setEntryValue } =
  useLocale()

const isBody = computed(() => selectedElement.value?.type === 'body')
const isCollectionList = computed(() => selectedElement.value?.type === 'collection-list')
const isCollectionItem = computed(() => selectedElement.value?.type === 'collection-item')
const isSlider = computed(() => selectedElement.value?.type === 'slider')

const isList = computed(() => isCollectionList.value || isSlider.value)

const hasSource = computed(() => isList.value || isCollectionItem.value)

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const tagOptions = computed(() =>
  typeOptionsFor(selectedElement.value?.type ?? '').map((t) => ({ label: capitalize(t), value: t })),
)

const canEditTag = computed(
  () =>
    tagOptions.value.length > 0 &&
    !!selectedElement.value &&
    backend.value.can(selectedElement.value, 'retype'),
)

const htmlId = computed({
  get: () => selectedElement.value?.htmlId ?? '',
  set: (value: string) => {
    if (selectedElement.value) selectedElement.value.htmlId = value.trim() || undefined
  },
})

const channelTarget = computed(() => editTarget.value ?? selectedElement.value ?? null)
const canChannel = computed(
  () => !!channelTarget.value && !isComponentType(selectedElement.value?.type ?? ''),
)
const channelRejected = ref(false)
const channel = computed({
  get: () => channelTarget.value?.channel ?? '',
  set: (value: string) => {
    const node = channelTarget.value
    if (!node) return
    channelRejected.value = !setElementChannel(node, value.trim() || null)
  },
})

const { pendingFocus } = usePanel()
const idField = ref<InstanceType<typeof InputUI>>()
const contentField = ref<InstanceType<typeof RichTextInput>>()

function consumeFocus() {
  if (pendingFocus.value !== 'data') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => (contentField.value ?? idField.value)?.focus())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)

const canLink = computed(() => {
  const el = selectedElement.value
  return (
    !!el &&
    backend.value.can(el, 'link') &&
    !isBody.value &&
    !isCollectionItem.value &&
    !isCollectionList.value &&
    !isSlider.value
  )
})
const link = computed({
  get: () => {
    const el = selectedElement.value
    if (!el) return ''
    return resolveInstanceValue(el, masterFor(el.id), 'link') ?? ''
  },
  set: (value: string) => {
    if (selectedElement.value) setElementLink(selectedElement.value.id, value.trim() || null)
  },
})

const canLinkEntry = computed(() => {
  const el = selectedElement.value
  if (!el || !canLink.value) return false
  if (activePage.value.collectionId) return true
  return (
    hasAncestorOfType(activePage.value.elements, el.id, 'collection-list') ||
    hasAncestorOfType(activePage.value.elements, el.id, 'slider')
  )
})

const linkToEntry = computed({
  get: () => selectedElement.value?.link === '@item',
  set: (on: boolean) => {
    if (selectedElement.value) setElementLink(selectedElement.value.id, on ? '@item' : null)
  },
})

const canBind = computed(
  () =>
    !!activeCollection.value &&
    !isBody.value &&
    !isCollectionItem.value &&
    !isCollectionList.value &&
    !isSlider.value &&
    !!selectedElement.value &&
    backend.value.can(selectedElement.value, 'arg'),
)

const bindHead = computed(() => selectedElement.value?.arg?.split('.')[0] ?? '')
const bindTail = computed(() => {
  const arg = selectedElement.value?.arg ?? ''
  const dot = arg.indexOf('.')
  return dot === -1 ? '' : arg.slice(dot + 1)
})

const headField = computed(
  () => activeCollection.value?.fields.find((f) => f.name === bindHead.value) ?? null,
)
const refTarget = computed(() =>
  headField.value?.type === 'reference' && headField.value.refCollectionId
    ? collectionById(headField.value.refCollectionId)
    : null,
)

const bindOptions = computed(() => [
  { label: 'None', value: '' },
  ...(activeCollection.value?.fields.map((f) => ({ label: f.name, value: f.name })) ?? []),
])

const tailOptions = computed(() => [
  { label: 'Entry name', value: '' },
  ...(refTarget.value?.fields
    .filter((f) => !['reference', 'multi-reference', 'multi-image'].includes(f.type))
    .map((f) => ({ label: f.name, value: f.name })) ?? []),
])

function setHead(head: string | null) {
  if (!selectedElement.value) return
  setElementArg(selectedElement.value.id, head || null)
}
function setTail(tail: string | null) {
  if (!selectedElement.value || !bindHead.value) return
  setElementArg(selectedElement.value.id, tail ? `${bindHead.value}.${tail}` : bindHead.value)
}

const listOptions = computed(() => {
  const options = collections.value.map((c) => ({ label: c.name, value: c.name }))
  if (isSlider.value) options.unshift({ label: 'None (manual slides)', value: '' })
  if (isCollectionItem.value) return options
  for (const f of activeCollection.value?.fields ?? []) {
    if (f.type === 'multi-reference' || f.type === 'multi-image') {
      options.push({ label: `${f.name} (field)`, value: f.name })
    }
  }
  return options
})

const listSource = computed({
  get: () => selectedElement.value?.arg ?? '',
  set: (value: string) => {
    if (selectedElement.value) setElementArg(selectedElement.value.id, value || null)
  },
})

const def = computed(() => (selectedElement.value ? ELEMENTS[selectedElement.value.type] : null))

const canAttrs = computed(() => !!selectedElement.value && !isBody.value)

const attrRows = ref<{ name: string; value: string; field: string }[]>([])
let syncingAttrs = false

watch(
  () => selectedElement.value?.id,
  () => {
    syncingAttrs = true
    const attrs = selectedElement.value?.attributes ?? {}
    const bound = selectedElement.value?.fieldAttrs ?? {}
    const names = [...new Set([...Object.keys(attrs), ...Object.keys(bound)])]
    attrRows.value = names.map((name) => ({
      name,
      value: String(attrs[name] ?? ''),
      field: bound[name] ?? '',
    }))
    nextTick(() => (syncingAttrs = false))
  },
  { immediate: true },
)

watch(
  attrRows,
  (rows) => {
    if (syncingAttrs || !selectedElement.value) return
    const clean = sanitizeAttributes(Object.fromEntries(rows.map((r) => [r.name, r.value])))
    if (Object.keys(clean).length) selectedElement.value.attributes = clean
    else delete selectedElement.value.attributes
    const bound: Record<string, string> = {}
    for (const row of rows) {
      const name = row.name.toLowerCase().trim()
      if (row.field && isAllowedAttribute(name)) bound[name] = row.field
    }
    if (Object.keys(bound).length) selectedElement.value.fieldAttrs = bound
    else delete selectedElement.value.fieldAttrs
  },
  { deep: true },
)

const attrFieldOptions = computed(() => [
  { label: 'Fixed value', value: '' },
  ...(activeCollection.value?.fields ?? []).map((f) => ({ label: f.name, value: f.name })),
])

function addAttr() {
  attrRows.value.push({ name: '', value: '', field: '' })
}
function removeAttr(i: number) {
  attrRows.value.splice(i, 1)
}
function attrInvalid(name: string): boolean {
  return name.trim() !== '' && !isAllowedAttribute(name)
}

const sourceCollection = computed(() =>
  isList.value ? (collectionByName(listSource.value) ?? null) : null,
)
const listFields = computed(() => sourceCollection.value?.fields ?? [])

const lq = computed(() => selectedElement.value?.listQuery ?? {})

function patchListQuery(partial: Record<string, unknown>) {
  const el = selectedElement.value
  if (!el) return
  const next: Record<string, unknown> = { ...(el.listQuery ?? {}), ...partial }
  for (const k of Object.keys(next)) {
    const v = next[k]
    if (v === '' || v == null || (Array.isArray(v) && v.length === 0)) delete next[k]
  }
  if (next.filter && !(next.filter as { field?: string }).field) delete next.filter
  if (Object.keys(next).length) el.listQuery = next as typeof el.listQuery
  else delete el.listQuery
}

const isForm = computed(() => selectedElement.value?.type === 'form')
const fm = computed(() => selectedElement.value?.form ?? {})

function patchForm(partial: Record<string, unknown>) {
  const el = selectedElement.value
  if (!el) return
  const next: Record<string, unknown> = { ...(el.form ?? {}), ...partial }
  for (const key of Object.keys(next)) {
    const value = next[key]
    if (value == null || value === '' || value === false) delete next[key]
  }
  if (!next.enabled) {
    delete next.notify
    delete next.forward
    delete next.redirect
  }
  if (Object.keys(next).length) el.form = next as typeof el.form
  else delete el.form
}

const formRedirectError = computed(() => formConfigError(fm.value))

const routeOptions = computed(() => [
  { label: 'Show the success message', value: '' },
  ...pages.value
    .filter((p) => p.status === 'published' && !p.collectionId)
    .map((p) => ({
      label: p.name,
      value: `/${String(p.path ?? '').replace(/^\/+|\/+$/g, '')}`,
    })),
])

const formFields = computed(() => {
  const el = selectedElement.value
  if (!el || !isForm.value) return { fields: [], unnamed: [], duplicates: [] }
  return collectFormFields(el, (node: ElementNode) => resolveAttributes(node), {
    hidden: (node: ElementNode) => isNodeHidden(node, masterFor(node.id)),
    content: (node: ElementNode) => resolveContent(node),
  })
})

function resolveContent(node: ElementNode): string {
  const mapping = masterFor(node.id)
  if (node.content) return node.content
  if (!mapping) return ''
  return [...mapping.mirrors, mapping.master].map((n) => n.content).find(Boolean) ?? ''
}

function resolveAttributes(node: ElementNode): Record<string, string> {
  const mapping = masterFor(node.id)
  const shared = mapping ? mapping.master.attributes : node.attributes
  return mergeAttributeLayers(shared, node.instanceAttributes, undefined) as Record<string, string>
}

function addFormState(type: 'form-success' | 'form-error') {
  const el = selectedElement.value
  if (!el) return
  backend.value.insert({ kind: 'element', type }, el.id, 'inside')
}

const hasFormState = (type: string) =>
  (selectedElement.value?.children ?? []).some((c) => c.type === type)

const { openModal: openFormModal } = useModal()
const viewSubmissions = () => {
  const el = selectedElement.value
  if (el) openFormModal(FormSubmissionsModal, { formId: el.id })
}

const apiOriginMissing = computed(
  () =>
    fm.value.enabled === true &&
    settings.value.publishing.method !== 'server' &&
    !settings.value.publishing.apiOrigin,
)

const sliderBreakpoints = computed(() => [...breakpoints.value].sort((a, b) => b.width - a.width))

const sl = computed(() => selectedElement.value?.slider ?? {})
const slResolved = computed(() => resolveSliderConfig(sl.value, breakpoints.value))

function patchSlider(partial: Record<string, unknown>) {
  const el = selectedElement.value
  if (!el) return
  const next: Record<string, unknown> = { ...(el.slider ?? {}), ...partial }
  for (const key of Object.keys(next)) {
    const value = next[key]
    if (value == null || value === '') delete next[key]
    else if (key !== 'perView' && value === SLIDER_DEFAULTS[key as keyof typeof SLIDER_DEFAULTS]) {
      delete next[key]
    }
  }
  const perView = next.perView as Record<string, number> | undefined
  if (perView) {
    const live = new Set(breakpoints.value.map((b) => b.id))
    for (const key of Object.keys(perView)) {
      if (key === 'base') {
        if (perView[key] === 1) delete perView[key]
      } else if (!live.has(key)) delete perView[key]
    }
    if (!Object.keys(perView).length) delete next.perView
  }
  if (!next.autoplay) delete next.delay
  if (Object.keys(next).length) el.slider = next as typeof el.slider
  else delete el.slider
}

function perViewOf(id: string) {
  const stored = sl.value.perView?.[id]
  return stored === undefined ? '' : String(stored)
}

function perViewPlaceholder(id: string) {
  const list = sliderBreakpoints.value
  const index = list.findIndex((b) => b.id === id)
  for (let i = index - 1; i >= 0; i--) {
    const wider = sl.value.perView?.[list[i]!.id]
    if (wider !== undefined) return String(wider)
  }
  return String(sl.value.perView?.base ?? 1)
}

function setPerView(id: string, raw: string) {
  const next = { ...(sl.value.perView ?? {}) }
  const n = parseInt(raw, 10)
  if (Number.isFinite(n) && n > 0) next[id] = Math.min(8, n)
  else delete next[id]
  patchSlider({ perView: next })
}

const gapText = computed(() => (sl.value.gap ? String(sl.value.gap) : ''))
function setGap(raw: string) {
  const n = parseInt(raw, 10)
  patchSlider({ gap: Number.isFinite(n) && n > 0 ? Math.min(500, n) : undefined })
}

const delayText = computed(() => (sl.value.delay ? String(sl.value.delay) : ''))
function setDelay(raw: string) {
  const n = parseInt(raw, 10)
  patchSlider({ delay: Number.isFinite(n) && n >= 500 ? Math.min(60000, n) : undefined })
}

const orderOptions = computed(() => [
  { label: 'Default', value: '' },
  { label: 'Entry name', value: 'name' },
  { label: 'Created', value: 'createdAt' },
  ...listFields.value.map((f) => ({ label: f.name, value: f.name })),
])
const dirOptions = [
  { label: 'Ascending', value: 'asc' },
  { label: 'Descending', value: 'desc' },
]

const limitText = computed(() => (lq.value.limit ? String(lq.value.limit) : ''))
function setLimit(raw: string) {
  const n = parseInt(raw, 10)
  patchListQuery({ limit: Number.isFinite(n) && n > 0 ? n : undefined })
}

const offsetText = computed(() => (lq.value.offset ? String(lq.value.offset) : ''))
function setOffset(raw: string) {
  const n = parseInt(raw, 10)
  patchListQuery({ offset: Number.isFinite(n) && n > 0 ? n : undefined })
}

const onTemplatePage = computed(() => !!activePage.value?.collectionId)
const excludeCurrent = computed(() => !!lq.value.excludeCurrent)
function setExcludeCurrent(on: boolean) {
  patchListQuery({ excludeCurrent: on ? true : undefined })
}

const filterFieldOptions = computed(() => [
  { label: 'None', value: '' },
  ...listFields.value.map((f) => ({ label: f.name, value: f.name })),
])
const filterMode = computed(() =>
  lq.value.filter?.equalsCurrent
    ? 'equalsCurrent'
    : lq.value.filter?.notEmpty
      ? 'notEmpty'
      : 'equals',
)
const filterModeOptions = [
  { label: 'is', value: 'equals' },
  { label: 'is not empty', value: 'notEmpty' },
  { label: 'is this entry', value: 'equalsCurrent' },
]
function filterFor(mode: string, field: string) {
  if (mode === 'notEmpty') return { field, notEmpty: true }
  if (mode === 'equalsCurrent') return { field, equalsCurrent: true }
  return { field, equals: lq.value.filter?.equals ?? '' }
}
function setFilterField(field: string) {
  if (!field) return patchListQuery({ filter: undefined })
  patchListQuery({ filter: filterFor(filterMode.value, field) })
}
function setFilterMode(mode: string) {
  const field = lq.value.filter?.field
  if (!field) return
  patchListQuery({ filter: filterFor(mode, field) })
}
function setFilterValue(value: string) {
  const field = lq.value.filter?.field
  if (!field) return
  patchListQuery({ filter: { field, equals: value } })
}

function isPicked(id: string): boolean {
  return !lq.value.pick || lq.value.pick.includes(id)
}
function setPick(ids: string[]) {
  const el = selectedElement.value
  if (!el) return
  const all = sourceCollection.value?.entries.map((e) => e.id) ?? []
  if (ids.length === all.length) {
    if (el.listQuery) {
      const { pick: _drop, ...rest } = el.listQuery
      el.listQuery = Object.keys(rest).length ? rest : undefined
    }
    return
  }
  el.listQuery = { ...(el.listQuery ?? {}), pick: ids }
}
function togglePick(id: string) {
  const all = sourceCollection.value?.entries.map((e) => e.id) ?? []
  const cur = lq.value.pick ?? all
  setPick(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
}

const itemCollection = computed(() =>
  isCollectionItem.value && selectedElement.value?.arg
    ? collectionByName(selectedElement.value.arg)
    : null,
)

const entryOptions = computed(() => [
  { label: 'None', value: '' },
  ...(itemCollection.value?.entries.map((e) => ({ label: e.name, value: e.id })) ?? []),
])

const isCustomCode = computed(() => selectedElement.value?.type === 'custom-code')
const hasContent = computed(() => def.value?.defaultContent !== undefined && !isCustomCode.value)
const isMedia = computed(() => ['image', 'video'].includes(selectedElement.value?.type ?? ''))

const collectionOptions = computed(() => collections.value.map((c) => ({ label: c.name, value: c.id })))

function onFieldTypeChange(field: CollectionField, type: CollectionField['type']) {
  setFieldType(field, type, collections.value)
}

function setFieldOptions(field: CollectionField, text: string) {
  const next = [...new Set(text.split('\n').map((o) => o.trim()).filter(Boolean))]
  if (next.length) field.options = next
  else delete field.options
}

interface ResolvedBinding {
  collection: { id: string }
  field: CollectionField
  entry: CollectionEntry | null
}

const binding = computed<ResolvedBinding | null>(() =>
  resolveBinding(collections.value, activeCollection.value, activeEntry.value, selectedElement.value?.arg),
)
const boundField = computed(() => binding.value?.field ?? null)
const boundIsRef = computed(() => !!boundField.value && isRefType(boundField.value.type))

const pickRefTarget = computed(() =>
  headField.value?.refCollectionId ? collectionById(headField.value.refCollectionId) : null,
)

const entryField = useEntryField()

const bound = computed(() =>
  headField.value && activeEntry.value
    ? { entry: activeEntry.value, field: headField.value }
    : null,
)

const refValue = computed({
  get: () => (bound.value ? entryField.readRef(bound.value.entry, bound.value.field) : ''),
  set: (id: string) => {
    if (bound.value) entryField.setRef(bound.value.entry, bound.value.field, id)
  },
})
const refOptions = computed(() => [
  { label: 'None', value: '' },
  ...(pickRefTarget.value?.entries.map((e) => ({ label: e.name, value: e.id })) ?? []),
])

const multiIds = computed(() =>
  bound.value ? refIds(bound.value.entry, bound.value.field.name) : [],
)
const galleryUrls = computed(() =>
  bound.value ? mediaUrls(bound.value.entry, bound.value.field.name) : [],
)
function setGalleryAt(index: number, url: string) {
  if (bound.value) entryField.setListAt(bound.value.entry, bound.value.field, index, url)
}
function addGalleryImage(url: string) {
  if (url && bound.value) {
    entryField.writeList(bound.value.entry, bound.value.field, [...galleryUrls.value, url])
  }
}
function moveGalleryImage(index: number, delta: -1 | 1) {
  if (bound.value) entryField.moveInList(bound.value.entry, bound.value.field, index, delta)
}
const showGalleryPicker = computed(
  () => headField.value?.type === 'multi-image' && !!activeEntry.value,
)

function toggleRef(id: string) {
  if (bound.value) entryField.toggleRef(bound.value.entry, bound.value.field, id)
}

const showRefPicker = computed(
  () => !!headField.value && isRefType(headField.value.type) && !!activeEntry.value,
)

const content = computed({
  get: () => {
    if (boundField.value && !boundIsRef.value && binding.value?.entry) {
      return editEntryValue(binding.value.entry, boundField.value.name)
    }
    return selectedElement.value ? editNodeContent(selectedElement.value) : ''
  },
  set: (value: string) => {
    if (boundField.value && !boundIsRef.value && binding.value?.entry) {
      setEntryValue(binding.value.entry, boundField.value.name, value)
    } else if (selectedElement.value) {
      setNodeContent(selectedElement.value, value)
    }
  },
})

const contentPlaceholder = computed(() => {
  if (!isDefault.value) {
    const entry = binding.value?.entry
    const base =
      boundField.value && !boundIsRef.value && entry
        ? entry.values[boundField.value.name]
        : selectedElement.value?.content
    if (typeof base === 'string' && base) return base
  }
  return def.value?.defaultContent
})

const { canBuild } = useAuth()
const { isHidden, setHidden } = useComponents()

const instance = computed(() => {
  const node = selectedElement.value
  const mapping = node && canBuild.value ? masterFor(node.id) : null
  const wrapper = mapping ? getElement(mapping.instanceId) : null
  return mapping && wrapper
    ? { def: mapping.def, picks: mapping.picks, wrapper, mirrors: masterFor(wrapper.id)?.mirrors ?? [] }
    : null
})

const instanceAxes = computed(() =>
  (instance.value?.def.variants ?? []).map((axis) => ({
    name: axis.name,
    value: instance.value!.picks[axis.name] ?? axis.default,
    options: axis.options.map((option) => ({ label: option, value: option })),
  })),
)

function pickVariant(axis: string, option: string | undefined) {
  const at = instance.value
  if (at && option) setInstancePick(at.def, at.wrapper, axis, option, at.mirrors)
}

const instanceParts = computed(() => {
  const at = instance.value
  if (!at) return []
  const parts: { node: (typeof at)['wrapper']; label: string; shown: boolean }[] = []
  walkNodes(at.wrapper.children, (node) => {
    const mapping = masterFor(node.id)
    const sources = mapping ? [node, ...mapping.mirrors, mapping.master] : [node]
    if (sources.every((source) => source.hidden === undefined)) return
    const text = (sources.find((source) => source.content)?.content ?? '')
      .replace(/<[^>]*>/g, ' ')
      .trim()
    parts.push({ node, label: text || node.type, shown: !isHidden(node) })
  })
  const seen = new Map<string, number>()
  const total = new Map<string, number>()
  for (const p of parts) total.set(p.label, (total.get(p.label) ?? 0) + 1)
  return parts.map((p) => {
    if (total.get(p.label) === 1) return p
    const n = (seen.get(p.label) ?? 0) + 1
    seen.set(p.label, n)
    return { ...p, label: `${p.label} ${n}` }
  })
})

const { boardActive, activeCard } = useComponentBoard()
const { project } = useProject()
const canSlot = computed(() => {
  const node = selectedElement.value
  const def = activeCard.value?.def
  return (
    !!node && !!def && boardActive.value && canBuild.value &&
    node !== def.root && !masterFor(node.id) && acceptsChildren(node)
  )
})
const isSlot = computed({
  get: () => !!selectedElement.value?.slot,
  set: (value) => {
    const node = selectedElement.value
    const def = activeCard.value?.def
    if (!node || !def) return
    if (value) node.slot = true
    else delete node.slot
    pushMasterStructure(project.value, def)
  },
})

const isIcon = computed(() => selectedElement.value?.type === 'icon' && canBuild.value)

const svg = computed({
  get: () => {
    const node = selectedElement.value
    if (!node) return ''
    if (node.svg) return node.svg
    const mapping = masterFor(node.id)
    return (mapping ? [...mapping.mirrors, mapping.master] : []).find((n) => n.svg)?.svg ?? ''
  },
  set: (value: string) => {
    const node = selectedElement.value
    if (!node) return
    if (value) node.svg = value
    else delete node.svg
  },
})

const src = computed({
  get: () => {
    if (boundField.value?.type === 'image' && binding.value?.entry) {
      return editEntryValue(binding.value.entry, boundField.value.name)
    }
    return selectedElement.value ? editNodeSrc(selectedElement.value) : ''
  },
  set: (value: string) => {
    if (boundField.value?.type === 'image' && binding.value?.entry) {
      setEntryValue(binding.value.entry, boundField.value.name, value)
    } else if (selectedElement.value) {
      setNodeSrc(selectedElement.value, value)
    }
  },
})
</script>

<template>
  <template v-if="selectedElement">
    <GroupPopover v-if="isBody && activeCollection" label="Fields">
      <div v-for="field in activeCollection.fields" :key="field.id" class="flex flex-col gap-1">
        <RowUI :label="field.name">
          <InputUI v-model="field.name" class="font-mono" />
          <SelectUI
            :model-value="field.type"
            :options="FIELD_TYPES"
            class="w-24"
            @update:model-value="(v) => v && onFieldTypeChange(field, v as never)"
          />
          <template #end>
            <ButtonUI
              variant="icon"
              size="sm"
              :icon="X"
              tooltip="Remove field"
              class="w-6 shrink-0 text-muted-foreground"
              @click="removeField(activeCollection!, field.id)"
            />
          </template>
        </RowUI>
        <RowUI v-if="isRefType(field.type)" label="To">
          <SelectUI v-model="field.refCollectionId" :options="collectionOptions" />
        </RowUI>
        <RowUI v-if="field.type === 'select'" label="Options">
          <textarea
            :value="(field.options ?? []).join('\n')"
            rows="3"
            spellcheck="false"
            class="w-full rounded-md border border-border bg-input px-2 py-1 text-xs"
            @change="(e) => setFieldOptions(field, (e.target as HTMLTextAreaElement).value)"
          />
        </RowUI>
        <RowUI v-if="field.type === 'text'" label="Translatable">
          <ToggleUI
            :model-value="field.localize !== false"
            @update:model-value="(v) => (field.localize = v ? undefined : false)"
          />
        </RowUI>
      </div>
      <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addField(activeCollection!)">
        Add field
      </ButtonUI>
    </GroupPopover>

    <GroupPopover v-if="showRefPicker" :label="headField!.name">
      <SelectUI v-if="headField!.type === 'reference'" v-model="refValue" :options="refOptions" />
      <template v-else>
        <label
          v-for="entry in pickRefTarget?.entries ?? []"
          :key="entry.id"
          class="flex cursor-pointer items-center gap-2 text-xs"
        >
          <input
            type="checkbox"
            :checked="multiIds.includes(entry.id)"
            class="accent-current"
            @change="toggleRef(entry.id)"
          />
          {{ entry.name }}
        </label>
        <p v-if="!pickRefTarget?.entries.length" class="text-[10px] text-muted-foreground">
          No entries in the referenced collection yet.
        </p>
      </template>
    </GroupPopover>

    <GroupPopover v-if="showGalleryPicker" :label="headField!.name">
      <div v-for="(url, i) in galleryUrls" :key="`${url}-${i}`" class="flex items-start gap-1">
        <MediaPickerControl
          :model-value="url"
          kind="image"
          class="flex-1"
          @update:model-value="(v) => setGalleryAt(i, v)"
        />
        <div class="flex flex-col">
          <ButtonUI
            variant="ghost"
            size="sm"
            :icon="ChevronUp"
            :disabled="i === 0"
            tooltip="Move up"
            @click="moveGalleryImage(i, -1)"
          />
          <ButtonUI
            variant="ghost"
            size="sm"
            :icon="ChevronDown"
            :disabled="i === galleryUrls.length - 1"
            tooltip="Move down"
            @click="moveGalleryImage(i, 1)"
          />
        </div>
      </div>
      <MediaPickerControl
        :key="`add-${galleryUrls.length}`"
        model-value=""
        kind="image"
        @update:model-value="addGalleryImage"
      />
      <p class="text-[10px] text-muted-foreground">
        Rendered by <span class="font-mono">:collection-list[{{ headField!.name }}]</span> — one
        item per image.
      </p>
    </GroupPopover>

    <GroupPopover v-if="hasContent && !boundIsRef">
      <RichTextInput ref="contentField" v-model="content" :placeholder="contentPlaceholder" />
    </GroupPopover>

    <GroupPopover v-if="isCustomCode && canBuild" label="Code">
      <TextareaUI
        v-model="content"
        :rows="8"
        class="font-mono"
        placeholder="<script src=&quot;https://…&quot;></script>"
        data-custom-code-input
      />
      <p class="text-[10px] text-muted-foreground">
        Emitted as-is on the published page, inside this element. Shown as a placeholder here.
      </p>
    </GroupPopover>

    <GroupPopover
      v-if="instance && (instanceAxes.length || instanceParts.length)"
      :label="instance.def.name"
      data-instance-section
    >

      <div
        v-for="axis in instanceAxes"
        :key="axis.name"
        class="flex flex-col gap-1"
        :data-instance-pick="axis.name"
      >
        <span class="text-[10px] text-muted-foreground">{{ axis.name }}</span>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="option in axis.options"
            :key="option.value"
            type="button"
            class="h-6 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
            :class="
              axis.value === option.value
                ? 'bg-accent/30 font-medium text-foreground'
                : 'bg-input text-muted-foreground hover:text-foreground'
            "
            :aria-pressed="axis.value === option.value"
            @click="pickVariant(axis.name, option.value)"
          >
            {{ option.value }}
          </button>
        </div>
      </div>
      <RowUI v-for="part in instanceParts" :key="part.node.id" :label="part.label">
        <ToggleUI
          :model-value="part.shown"
          :data-instance-part="part.label"
          @update:model-value="(v) => setHidden(part.node, !v)"
        />
      </RowUI>
    </GroupPopover>

    <GroupPopover v-if="canSlot" label="Component">
      <RowUI label="Slot">
        <ToggleUI v-model="isSlot" data-slot-toggle />
      </RowUI>
      <p v-if="isSlot" class="px-1 text-xs text-muted-foreground">
        Each instance holds its own content here; what is inside now is the default a new one starts from.
      </p>
    </GroupPopover>

    <GroupPopover v-if="isIcon" label="Icon">
      <IconPickerControl v-model="svg" />
    </GroupPopover>

    <GroupPopover v-if="isMedia">
      <MediaPickerControl v-model="src" :kind="selectedElement.type === 'video' ? 'video' : 'image'" />
    </GroupPopover>

    <GroupPopover>
      <RowUI v-if="canEditTag" label="Tag">
        <SelectUI
          :model-value="selectedElement.type"
          :options="tagOptions"
          @update:model-value="(v) => changeElementType(selectedElement!.id, v!)"
        />
      </RowUI>
      <RowUI label="ID">
        <InputUI ref="idField" v-model="htmlId" placeholder="e.g. hero" class="font-mono" />
      </RowUI>
      <RowUI v-if="canChannel" label="Channel">
        <InputUI
          v-model="channel"
          placeholder="e.g. start"
          class="font-mono"
          :class="channelRejected && 'text-danger'"
        />
      </RowUI>
      <RowUI v-if="canLinkEntry" label="Link to entry">
        <ToggleUI v-model="linkToEntry" />
      </RowUI>
      <RowUI v-if="canLink && !linkToEntry" label="Link">
        <InputUI v-model="link" placeholder="/about or https://…" class="font-mono" />
      </RowUI>
    </GroupPopover>

    <GroupPopover v-if="canBind" label="Binding">
      <RowUI label="Field">
        <SelectUI :options="bindOptions" :model-value="bindHead" @update:model-value="(v) => setHead(v ?? null)" />
      </RowUI>
      <RowUI v-if="refTarget" label="Show">
        <SelectUI :options="tailOptions" :model-value="bindTail" @update:model-value="(v) => setTail(v ?? null)" />
      </RowUI>
      <p v-if="headField?.type === 'multi-reference'" class="text-[10px] text-muted-foreground">
        Shows the referenced entry names. Use a collection list to repeat per entry.
      </p>
    </GroupPopover>

    <GroupPopover v-if="isForm" label="Form">
      <RowUI label="Accept submissions">
        <ToggleUI
          :model-value="fm.enabled === true"
          @update:model-value="(v) => patchForm({ enabled: v })"
        />
      </RowUI>
      <p v-if="!fm.enabled" class="text-[10px] text-muted-foreground">
        Off: this stays a plain form that posts nowhere. Turn it on and submissions are
        stored on this instance.
      </p>
      <template v-if="fm.enabled">
        <RowUI label="Name">
          <InputUI
            :model-value="fm.name ?? ''"
            placeholder="Contact"
            @update:model-value="(v) => patchForm({ name: v })"
          />
        </RowUI>
        <RowUI label="Email me">
          <ToggleUI
            :model-value="fm.notify === true"
            @update:model-value="(v) => patchForm({ notify: v })"
          />
        </RowUI>
        <RowUI label="Send to webhook">
          <ToggleUI
            :model-value="fm.forward === true"
            @update:model-value="(v) => patchForm({ forward: v })"
          />
        </RowUI>
        <p v-if="fm.notify || fm.forward" class="text-[10px] text-muted-foreground">
          Recipients and the integration that sends are set by an admin in Settings → Forms.
        </p>
        <RowUI label="On success">
          <SelectUI
            :options="routeOptions"
            :model-value="fm.redirect ?? ''"
            @update:model-value="(v) => patchForm({ redirect: v ?? '' })"
          />
        </RowUI>
        <p v-if="formRedirectError" class="text-[10px] text-danger">{{ formRedirectError }}</p>

        <RowUI v-if="canBuild" label="Submissions">
          <ButtonUI variant="outline" size="sm" :icon="Inbox" @click="viewSubmissions">
            View submissions
          </ButtonUI>
        </RowUI>

        <RowUI label="States">
          <ButtonUI
            variant="outline"
            size="sm"
            :icon="Plus"
            :disabled="hasFormState('form-success')"
            @click="addFormState('form-success')"
          >
            Success
          </ButtonUI>
          <ButtonUI
            variant="outline"
            size="sm"
            :icon="Plus"
            :disabled="hasFormState('form-error')"
            @click="addFormState('form-error')"
          >
            Error
          </ButtonUI>
        </RowUI>

        <div class="flex flex-col gap-1">
          <p class="text-[10px] font-medium">Fields</p>
          <p
            v-for="field in formFields.fields"
            :key="field.name"
            class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
          >
            <span class="truncate font-mono">{{ field.name }}</span>
            <span class="shrink-0">
              {{ field.kind }}{{ field.required ? ' · required' : '' }}
            </span>
          </p>
          <p v-if="!formFields.fields.length" class="text-[10px] text-muted-foreground">
            No named fields yet — give each control a <span class="font-mono">name</span>
            attribute. Only named controls are submitted.
          </p>
          <p v-if="formFields.unnamed.length" class="text-[10px] text-pending">
            {{ formFields.unnamed.length }}
            {{ formFields.unnamed.length === 1 ? 'control has' : 'controls have' }}
            no usable name and will not be submitted.
          </p>
          <p v-if="formFields.duplicates.length" class="text-[10px] text-pending">
            Two controls share the name {{ formFields.duplicates.join(', ') }} — only the first
            is stored.
          </p>
        </div>

        <p v-if="apiOriginMissing" class="text-[10px] text-pending">
          This site publishes as {{ settings.publishing.method }}, so set the studio URL in
          Settings → Publish or submissions have nowhere to go.
        </p>
      </template>
    </GroupPopover>

    <GroupPopover v-if="isSlider" label="Slider">
      <RowUI label="Arrows">
        <ToggleUI
          :model-value="slResolved.arrows"
          @update:model-value="(v) => patchSlider({ arrows: v })"
        />
      </RowUI>
      <RowUI label="Dots">
        <ToggleUI :model-value="slResolved.dots" @update:model-value="(v) => patchSlider({ dots: v })" />
      </RowUI>
      <RowUI label="Gap">
        <InputUI :model-value="gapText" type="number" placeholder="0" @update:model-value="setGap" />
      </RowUI>
      <RowUI
        v-for="(bp, i) in sliderBreakpoints"
        :key="bp.id"
        :label="i === 0 ? 'Per view' : bp.name"
      >
        <InputUI
          :model-value="i === 0 ? String(sl.perView?.base ?? '') : perViewOf(bp.id)"
          type="number"
          :placeholder="i === 0 ? '1' : perViewPlaceholder(bp.id)"
          @update:model-value="(v) => setPerView(i === 0 ? 'base' : bp.id, v)"
        />
      </RowUI>
      <p v-if="sliderBreakpoints.length > 1" class="text-[10px] text-muted-foreground">
        How many slides are visible at once. A blank breakpoint inherits the next wider one.
      </p>
      <RowUI label="Autoplay">
        <ToggleUI
          :model-value="slResolved.autoplay"
          @update:model-value="(v) => patchSlider({ autoplay: v })"
        />
      </RowUI>
      <RowUI v-if="slResolved.autoplay" label="Every">
        <InputUI
          :model-value="delayText"
          type="number"
          placeholder="4000"
          @update:model-value="setDelay"
        />
      </RowUI>
      <p v-if="slResolved.autoplay" class="text-[10px] text-muted-foreground">
        Milliseconds between slides. Autoplay never runs for a visitor who asks for reduced motion.
      </p>
      <RowUI label="Loop">
        <ToggleUI :model-value="slResolved.loop" @update:model-value="(v) => patchSlider({ loop: v })" />
      </RowUI>
      <RowUI label="Drag">
        <ToggleUI :model-value="slResolved.drag" @update:model-value="(v) => patchSlider({ drag: v })" />
      </RowUI>
      <p class="text-[10px] text-muted-foreground">
        Arrows, dots and dragging run in Preview and on the published site.
      </p>
    </GroupPopover>

    <GroupPopover v-if="hasSource" label="Source">
      <SelectUI :options="listOptions" v-model="listSource" />
      <p class="text-[10px] text-muted-foreground">
        {{
          isCollectionItem
            ? 'The collection this renders one entry of, through its template.'
            : isSlider
            ? 'With a source each entry becomes a slide; with none, each block inside is one slide.'
            : 'A collection repeats all entries; a multi-reference field repeats the entries it points to.'
        }}
      </p>
      <template v-if="!isSlider || listSource">
        <RowUI label="Order by">
          <SelectUI
            :options="orderOptions"
            :model-value="lq.sortField ?? ''"
            @update:model-value="(v) => patchListQuery({ sortField: v ?? '' })"
          />
        </RowUI>
        <RowUI v-if="lq.sortField" label="Direction">
          <SelectUI
            :options="dirOptions"
            :model-value="lq.sortDir ?? 'asc'"
            @update:model-value="(v) => patchListQuery({ sortDir: v })"
          />
        </RowUI>
        <RowUI label="Limit">
          <InputUI :model-value="limitText" type="number" placeholder="All" @update:model-value="setLimit" />
        </RowUI>
        <RowUI label="Skip">
          <InputUI :model-value="offsetText" type="number" placeholder="0" @update:model-value="setOffset" />
        </RowUI>
        <RowUI v-if="onTemplatePage" label="Exclude current">
          <ToggleUI :model-value="excludeCurrent" @update:model-value="setExcludeCurrent" />
        </RowUI>
        <RowUI label="Filter">
          <SelectUI
            :options="filterFieldOptions"
            :model-value="lq.filter?.field ?? ''"
            @update:model-value="(v) => setFilterField(v ?? '')"
          />
        </RowUI>
        <template v-if="lq.filter?.field">
          <RowUI label="Where">
            <SelectUI
              :options="filterModeOptions"
              :model-value="filterMode"
              @update:model-value="(v) => v && setFilterMode(v)"
            />
          </RowUI>
          <RowUI v-if="filterMode === 'equals'" label="Value">
            <InputUI
              :model-value="lq.filter?.equals ?? ''"
              class="font-mono"
              @update:model-value="setFilterValue"
            />
          </RowUI>
        </template>
      </template>
    </GroupPopover>

    <GroupPopover v-if="isList && sourceCollection" label="Entries">
      <p v-if="!sourceCollection.entries.length" class="text-[10px] text-muted-foreground">
        No entries in this collection yet.
      </p>
      <label
        v-for="entry in sourceCollection.entries"
        :key="entry.id"
        class="flex cursor-pointer items-center gap-2 text-xs"
      >
        <input
          type="checkbox"
          :checked="isPicked(entry.id)"
          class="accent-current"
          @change="togglePick(entry.id)"
        />
        {{ entry.name }}
      </label>
      <p class="text-[10px] text-muted-foreground">Uncheck an entry to hide it from this list.</p>
    </GroupPopover>

    <GroupPopover v-if="canAttrs" label="Attributes">
      <div v-for="(row, i) in attrRows" :key="i" class="flex flex-col gap-1">
        <div class="flex items-center gap-1">
          <InputUI v-model="row.name" placeholder="name" class="font-mono" />
          <InputUI
            v-model="row.value"
            :placeholder="row.field ? 'fallback' : 'value'"
            class="font-mono"
          />
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="X"
            tooltip="Remove attribute"
            class="w-6 shrink-0 text-muted-foreground"
            @click="removeAttr(i)"
          />
        </div>
        <SelectUI
          v-if="activeCollection"
          v-model="row.field"
          :options="attrFieldOptions"
          class="text-[11px]"
        />
        <p v-if="row.field" class="text-[10px] text-muted-foreground">
          Takes <span class="font-mono">{{ row.field }}</span> from each entry. The value beside
          the name is the fallback when the field is empty.
        </p>
        <p v-if="attrInvalid(row.name)" class="text-[10px] text-danger">
          “{{ row.name }}” isn’t allowed — use data-*, aria-*, or names like target, rel, title.
        </p>
      </div>
      <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addAttr">
        Add attribute
      </ButtonUI>
    </GroupPopover>

    <GroupPopover v-if="isCollectionItem" label="Entry">
      <SelectUI
        v-if="itemCollection"
        :options="entryOptions"
        :model-value="selectedElement.entryId ?? ''"
        @update:model-value="(v) => (selectedElement!.entryId = v || undefined)"
      />
      <p v-else class="text-xs text-muted-foreground">
        Unknown collection — check the (name) in the code.
      </p>
    </GroupPopover>
  </template>
</template>
