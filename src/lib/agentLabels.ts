const MODELS: [RegExp, string][] = [
  [/^claude-opus-5/, 'Opus 5'],
  [/^claude-opus-4-8/, 'Opus 4.8'],
  [/^claude-opus-4-7/, 'Opus 4.7'],
  [/^claude-opus-4-6/, 'Opus 4.6'],
  [/^claude-sonnet-5/, 'Sonnet 5'],
  [/^claude-sonnet-4-6/, 'Sonnet 4.6'],
  [/^claude-haiku-4-5/, 'Haiku 4.5'],
  [/^claude-fable-5-1/, 'Fable 5.1'],
  [/^claude-fable-5/, 'Fable 5'],
]

export const MODEL_CHOICES: { value: string; label: string }[] = [
  { value: 'opus', label: 'Opus 5' },
  { value: 'sonnet', label: 'Sonnet 5' },
  { value: 'haiku', label: 'Haiku 4.5' },
]

export function modelLabel(id: string | null): string {
  if (!id) return 'Model'
  const long = /\[1m\]$/i.test(id)
  const base = id.replace(/\[1m\]$/i, '')
  const found = MODELS.find(([re]) => re.test(base))?.[1]
  const label = found ?? base.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return long ? `${label} · 1M` : label
}

export function modelChoice(id: string | null): string | null {
  if (!id) return null
  const base = id.replace(/\[1m\]$/i, '')
  if (/^claude-opus/.test(base) || base === 'opus') return 'opus'
  if (/^claude-sonnet/.test(base) || base === 'sonnet') return 'sonnet'
  if (/^claude-haiku/.test(base) || base === 'haiku') return 'haiku'
  return null
}

/**
 * Harness bookkeeping, not something the agent did. Claude Code hands the
 * model tool NAMES and makes it fetch each schema on demand, so a first turn
 * carried three `ToolSearch` rows reading "Looked up its tools" — three of the
 * seven steps the person was shown. These are dropped from the activity bubble
 * and from the step count, and their results are consumed in silence.
 *
 * A DENIED harness tool still renders: a denial is never hidden
 * (`docs/agent-panel.md`).
 */
export const HARNESS_TOOLS: ReadonlySet<string> = new Set(['ToolSearch'])

type Input = Record<string, unknown>

const str = (input: Input, key: string): string | null => {
  const value = input[key]
  return typeof value === 'string' && value ? value : null
}

const count = (input: Input, key: string): number | null => {
  const value = input[key]
  return Array.isArray(value) ? value.length : null
}

const TOOLS: Record<string, (input: Input) => string> = {
  get_guide: (i) => (str(i, 'section') ? `Read the guide: ${str(i, 'section')}` : 'Read the guide'),
  get_status: () => 'Checked the project',
  set_target: (i) => `Set the target: ${str(i, 'target') ?? str(i, 'createDraft') ?? 'draft'}`,
  list_pages: () => 'Listed the pages',
  get_page: (i) => `Read ${str(i, 'pageId') ?? 'a page'}`,
  set_page_html: (i) => `Wrote ${str(i, 'pageId') ?? 'a page'}`,
  edit_structure: (i) => `Edited ${str(i, 'pageId') ?? str(i, 'componentId') ?? 'the structure'}`,
  edit_elements: (i) => {
    const n = count(i, 'edits')
    return n ? `Edited ${n} element${n === 1 ? '' : 's'}` : 'Edited elements'
  },
  create_page: (i) => `Created the page ${str(i, 'name') ?? str(i, 'path') ?? ''}`.trim(),
  update_page: (i) => `Updated ${str(i, 'pageId') ?? 'a page'}`,
  delete_page: (i) => `Deleted ${str(i, 'pageId') ?? 'a page'}`,
  set_page_seo: (i) => `Set SEO on ${str(i, 'pageId') ?? 'a page'}`,
  list_components: () => 'Listed the components',
  create_component: (i) => `Created the component ${str(i, 'name') ?? ''}`.trim(),
  create_components: (i) => {
    const n = count(i, 'components')
    return n ? `Created ${n} component${n === 1 ? '' : 's'}` : 'Created components'
  },
  update_component: (i) => `Updated ${str(i, 'name') ?? str(i, 'componentId') ?? 'a component'}`,
  duplicate_component: () => 'Duplicated a component',
  delete_component: () => 'Deleted a component',
  detach_instance: () => 'Detached an instance',
  set_component_variants: () => 'Set component variants',
  list_collections: () => 'Listed the collections',
  get_collection: (i) => `Read the collection ${str(i, 'collectionId') ?? ''}`.trim(),
  create_collection: (i) => `Created the collection ${str(i, 'name') ?? ''}`.trim(),
  update_collection: () => 'Updated a collection',
  delete_collection: () => 'Deleted a collection',
  upsert_entries: (i) => {
    const n = count(i, 'entries')
    return n ? `Saved ${n} entr${n === 1 ? 'y' : 'ies'}` : 'Saved entries'
  },
  delete_entry: () => 'Deleted an entry',
  list_interactions: () => 'Listed the interactions',
  create_interactions: () => 'Created interactions',
  update_interaction: () => 'Updated an interaction',
  delete_interaction: () => 'Deleted an interaction',
  bind_interaction: () => 'Bound an interaction',
  unbind_interaction: () => 'Unbound an interaction',
  list_animations: () => 'Listed the animations',
  create_animations: () => 'Created animations',
  update_animation: () => 'Updated an animation',
  delete_animation: () => 'Deleted an animation',
  get_settings: () => 'Read the settings',
  update_settings: () => 'Updated the settings',
  list_media: () => 'Listed the media',
  upload_media: () => 'Uploaded media',
  list_icons: () => 'Looked up icons',
  list_comments: () => 'Read the comments',
  create_comment: () => 'Left a comment',
  reply_to_comment: () => 'Replied to a comment',
  get_translation_worklist: () => 'Read the translation worklist',
  set_translations: () => 'Saved translations',
  list_integrations: () => 'Listed the integrations',
  list_form_submissions: () => 'Read form submissions',
  preview: () => 'Rendered a preview',
  publish: () => 'Published',
  use_project: () => 'Switched project',
  WebFetch: (i) => `Fetched ${str(i, 'url') ?? 'a page'}`,
  WebSearch: (i) => `Searched: ${str(i, 'query') ?? ''}`.trim(),
}

export function describeTool(name: string, input: unknown): string {
  const record =
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Input) : {}
  const known = TOOLS[name]
  if (known) return known(record)
  return name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
