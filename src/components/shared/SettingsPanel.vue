<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import {
  Archive, Check, ChevronRight, Code2, Copy, KeyRound, Languages, Palette, Pencil, Plug,
  Plus, Rocket, ScanSearch, Search, Settings, Settings2, Trash2, Type, UserRound, Users, X,
  Inbox, Mail, Webhook,
} from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import TabsUI from '@/components/tabs/TabsUI.vue'
import TabUI from '@/components/tabs/TabUI.vue'
import TabPanelUI from '@/components/tabs/TabPanelUI.vue'
import SettingsGroup from '@/components/shared/SettingsGroup.vue'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import IconTileUI from '@/components/ui/IconTileUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import EmptyListUI from '@/components/ui/EmptyListUI.vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import ColorPickerUI from '@/components/ui/ColorPickerUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import { useProject } from '@/composables/useProject'
import { SCROLL_LERP_DEFAULT, SCROLL_LERP_MIN, SCROLL_LERP_MAX } from '@/lib/motion'
import { useSettings } from '@/composables/useSettings'
import { useLocale } from '@/composables/useLocale'
import { usePublish } from '@/composables/usePublish'
import { useBranches } from '@/composables/useBranches'
import { useAuth } from '@/composables/useAuth'
import { useModal } from '@/composables/useModal'
import { useApiTokens } from '@/composables/useApiTokens'
import { useIntegrations } from '@/composables/useIntegrations'
import { useFormSubmissions } from '@/composables/useFormSubmissions'
import RenameModal from '@/components/modal/RenameModal.vue'
import {
  envRef,
  integrationNameError,
  keyNameError,
  normalizeKeyName,
  type Integration,
  type IntegrationField,
} from '@/lib/integrations'
import type { CustomFont, ElementNode, StructuredDataType } from '@/types/editor'
import { walkNodes } from '@/lib/tree'
import { SCHEMA_TYPES, customSchemaError } from '@/lib/shared/structuredData.js'
import UsersSettings from '@/components/shared/UsersSettings.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import {
  FONT_STACKS,
  tokenNameError,
  tokenNameNote,
  isThemeValue,
  fontError,
  fontFormatForMime,
  fontFormatForUrl,
} from '@/lib/settings'
import { useMedia } from '@/composables/useMedia'
import { timeAgo } from '@/lib/time'
import { formatBytes } from '@/lib/media'
import { downloadBlob, filenameFrom } from '@/lib/download'
import { apiJson } from '@/lib/api'

// opened on demand, never on first paint — split out of the editor chunk
const FormSubmissionsModal = defineAsyncComponent(() => import('@/components/editor/forms/FormSubmissionsModal.vue'))
const PublishDialog = defineAsyncComponent(() => import('@/components/shared/PublishDialog.vue'))

const { project, renameProject } = useProject()
const {
  settings, addToken, removeToken, smoothScroll,
  customFonts, addFont, removeFont,
  legacyHeadFonts, importLegacyHeadFonts, clearLegacyHeadFonts,
} = useSettings()
const { locales, defaultLocale, addLocale, deleteLocale, setDefaultLocale } = useLocale()

async function confirmDeleteLocale(loc: string) {
  const ok = await confirm({
    title: 'Delete locale',
    message: `Delete ${loc.toUpperCase()} and all of its translated content? The default locale keeps its content.`,
  })
  if (ok) deleteLocale(loc)
}
const { publishedInfo, unpublish } = usePublish()
const { onMain } = useBranches()
const { email: authEmail, name: authName, isAdmin, canBuild, canEditContent, updateAccount } = useAuth()
const { confirm, openModal } = useModal()

// opened via useModal (mounted = open); Esc/backdrop close through the host
const props = defineProps<{ initialSection?: string }>()
const emit = defineEmits<{ close: [] }>()

// a reviewer has no project sections to land on, only their own account
const active = ref(props.initialSection ?? (canEditContent.value ? 'general' : 'account'))

// --- nav: sections under Project / Site / Admin group headings; the Admin
// group is hidden entirely for non-admins ---

const NAV = computed(() => {
  const project = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'seo', label: 'SEO', icon: ScanSearch },
    { id: 'fonts', label: 'Fonts', icon: Type },
    { id: 'design', label: 'Design', icon: Palette },
  ]
  // a reviewer changes nothing about the project, so no Project group either
  const groups = canEditContent.value ? [{ label: 'Project', items: project }] : []
  if (canBuild.value) {
    const site = [
      { id: 'locales', label: 'Locales', icon: Languages },
      { id: 'publish', label: 'Publish', icon: Rocket },
    ]
    if (isAdmin.value) site.push({ id: 'code', label: 'Code', icon: Code2 })
    groups.push({ label: 'Site', items: site })
    const connect = [{ id: 'integrations', label: 'Integrations', icon: Plug }]
    // Forms is admin-only because everything on it is: who gets the
    // notification, which integration sends it, how long leads are kept
    if (isAdmin.value) connect.push({ id: 'forms', label: 'Forms', icon: Inbox })
    connect.push({ id: 'mcp', label: 'MCP', icon: KeyRound })
    groups.push({ label: 'Connect', items: connect })
  }
  if (isAdmin.value)
    groups.push({
      label: 'Admin',
      items: [
        { id: 'users', label: 'Users', icon: Users },
        { id: 'backup', label: 'Backup', icon: Archive },
      ],
    })
  return groups
})

// 'account' has no nav item (reached from the user card), so it's always valid
const NAVLESS_SECTIONS = ['account']

// if the active section disappears (e.g. role loads after mount), fall back
watch(NAV, (nav) => {
  if (NAVLESS_SECTIONS.includes(active.value)) return
  if (!nav.some((g) => g.items.some((i) => i.id === active.value))) {
    active.value = canEditContent.value ? 'general' : 'account'
  }
})

// --- my account (all roles; no nav item — opened from the user card) ---

const accName = ref(authName.value)
const accEmail = ref(authEmail.value ?? '')
const accPassword = ref('')
const accCurrentPassword = ref('')
const accError = ref<string | null>(null)
const accBusy = ref(false)
const accSaved = ref(false)

async function saveAccount() {
  if (accBusy.value) return
  accBusy.value = true
  accError.value = null
  accSaved.value = false
  try {
    await updateAccount({
      name: accName.value.trim(),
      email: accEmail.value.trim(),
      password: accPassword.value || undefined,
      currentPassword: accCurrentPassword.value || undefined,
    })
    accPassword.value = ''
    accCurrentPassword.value = ''
    accSaved.value = true
    setTimeout(() => (accSaved.value = false), 1600)
  } catch (e) {
    accError.value = e instanceof Error ? e.message : 'Update failed'
  } finally {
    accBusy.value = false
  }
}

// section search: filter the sidebar nav by label, dropping empty groups
const navQuery = ref('')
const filteredNav = computed(() => {
  const q = navQuery.value.trim().toLowerCase()
  if (!q) return NAV.value
  return NAV.value
    .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length)
})

// --- API tokens (admin/editor only; the server 403s contributors) ---

const { tokens, load: loadTokens, create: createToken, revoke: revokeTokenApi } = useApiTokens()

const apiTokenName = ref('')
const apiTokenBusy = ref(false)
const apiTokenError = ref<string | null>(null)
// the raw token, shown exactly once right after creation, then unrecoverable
const freshApiToken = ref<string | null>(null)
const freshApiName = ref('')
const apiTokenCopied = ref(false)
const addingToken = ref(false)
function closeAddToken() {
  addingToken.value = false
  freshApiToken.value = null
  apiTokenName.value = ''
  apiTokenError.value = null
}

onMounted(() => {
  if (canBuild.value) loadTokens().catch(() => {})
})

async function onCreateToken() {
  if (apiTokenBusy.value) return
  apiTokenError.value = null
  const label = apiTokenName.value.trim()
  if (!label) {
    apiTokenError.value = 'Give the token a name first'
    return
  }
  apiTokenBusy.value = true
  try {
    freshApiToken.value = await createToken(label)
    freshApiName.value = label
    apiTokenName.value = ''
    apiTokenCopied.value = false
  } catch (e) {
    apiTokenError.value = e instanceof Error ? e.message : 'Could not create the token'
  } finally {
    apiTokenBusy.value = false
  }
}

async function copyToken() {
  if (!freshApiToken.value) return
  await navigator.clipboard.writeText(freshApiToken.value).catch(() => {})
  apiTokenCopied.value = true
  setTimeout(() => (apiTokenCopied.value = false), 1600)
}

async function onRevokeToken(id: string, label: string) {
  const ok = await confirm({
    title: 'Revoke token',
    message: `Any MCP server or script using “${label}” will stop working immediately.`,
    confirmLabel: 'Revoke',
  })
  if (ok) await revokeTokenApi(id).catch((e) => (apiTokenError.value = e instanceof Error ? e.message : 'Failed'))
}

// --- agent policy (server/agent-policy.mjs, data/agent-policy.json) ---
//
// What a `guano_` token may do, held server-side and off by default. This panel
// is the ONLY surface for it, which is the whole reason it exists: the server's
// own refusals tell an agent to "enable agent Main writes in Settings", and
// until there was a control here the only way to say yes was to hand-edit
// agent-policy.json in the data dir — so a fresh instance left every agent
// permanently unable to touch Main, with nothing in the product to change it.
//
// Admin + session only, like /api/users: a token able to flip these would
// guard nothing, so an editor sees no group at all rather than a failing one.
type AgentFlag = 'allowMainWrites' | 'allowPublish' | 'allowCustomCode' | 'allowFormSubmissions'

const AGENT_SWITCHES: { id: AgentFlag; label: string; hint: string }[] = [
  {
    id: 'allowMainWrites',
    label: 'Write to Main',
    hint: 'Edits land on the live project with no review step. Off, an agent works in a draft you apply yourself.',
  },
  {
    id: 'allowPublish',
    label: 'Publish the site',
    hint: 'Let an agent put bytes on the live origin. Off, it can still preview its own work.',
  },
  {
    id: 'allowCustomCode',
    label: 'Change custom code',
    hint: 'Head/body code and custom-code blocks — raw script on every published page.',
  },
  {
    id: 'allowFormSubmissions',
    label: 'Read form submissions',
    hint: "Visitors' names, emails and messages. Deleting one is never allowed, by any switch.",
  },
]

const agentPolicy = ref<Record<AgentFlag, boolean>>({
  allowMainWrites: false,
  allowPublish: false,
  allowCustomCode: false,
  allowFormSubmissions: false,
})
const agentPolicyBusy = ref<AgentFlag | null>(null)
const agentPolicyError = ref<string | null>(null)

// immediate watch rather than onMounted: the role can resolve after this panel
// mounts (the same reason NAV is watched), and a missed load reads as all-off
watch(
  isAdmin,
  (admin) => {
    if (!admin) return
    apiJson('/api/agent-policy')
      .then((policy) => Object.assign(agentPolicy.value, policy))
      .catch(() => {
        /* best-effort, like the site gate */
      })
  },
  { immediate: true },
)

async function setAgentFlag(id: AgentFlag, value: boolean) {
  agentPolicyBusy.value = id
  agentPolicyError.value = null
  const before = agentPolicy.value[id]
  agentPolicy.value[id] = value // optimistic: the toggle must follow the finger
  try {
    Object.assign(
      agentPolicy.value,
      await apiJson('/api/agent-policy', { method: 'PUT', body: JSON.stringify({ [id]: value }) }),
    )
  } catch (e) {
    agentPolicy.value[id] = before
    agentPolicyError.value = e instanceof Error ? e.message : 'Save failed'
  } finally {
    agentPolicyBusy.value = null
  }
}

// --- general ---

const projectName = computed({
  get: () => project.value.name,
  set: (v: string) => renameProject(v),
})

const favicon = computed({
  get: () => settings.value.favicon ?? '',
  set: (v: string) => (settings.value.favicon = v || undefined),
})
const faviconDark = computed({
  get: () => settings.value.faviconDark ?? '',
  set: (v: string) => (settings.value.faviconDark = v || undefined),
})

// private site: one visitor password, kept hashed on the server (publish.json)
const siteGate = ref({ enabled: false, passwordSet: false })
const sitePasswordInput = ref('')
const siteGateBusy = ref(false)
const siteGateError = ref<string | null>(null)
onMounted(async () => {
  if (!canBuild.value) return
  try {
    const res = await fetch('/api/site-password')
    if (res.ok) siteGate.value = await res.json()
  } catch {
    /* best-effort */
  }
})
async function putSiteGate(patch: { enabled?: boolean; password?: string }) {
  siteGateBusy.value = true
  siteGateError.value = null
  try {
    const res = await fetch('/api/site-password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Save failed')
    const data = await res.json()
    siteGate.value = { enabled: data.enabled, passwordSet: data.passwordSet }
    return true
  } catch (e) {
    siteGateError.value = e instanceof Error ? e.message : 'Save failed'
    return false
  } finally {
    siteGateBusy.value = false
  }
}
const setSiteGateEnabled = (enabled: boolean) => putSiteGate({ enabled })
async function saveSitePassword() {
  if (!sitePasswordInput.value) return
  if (await putSiteGate({ password: sitePasswordInput.value })) sitePasswordInput.value = ''
}

// smooth scrolling (settings.motion.scroll): the slider reads as intensity —
// higher is snappier; lerp is the per-frame catch-up fraction underneath
const scrollLerp = computed({
  get: () => smoothScroll.value.lerp ?? SCROLL_LERP_DEFAULT,
  set: (v: number) => (smoothScroll.value.lerp = v),
})

// site-wide body code: an empty value drops the key so a project that never
// used it stays byte-identical
const siteBodyCode = computed({
  get: () => settings.value.customCode.body ?? '',
  set: (v: string) => {
    if (v) settings.value.customCode.body = v
    else delete settings.value.customCode.body
  },
})

const newLocale = ref('')
const addingLocale = ref(false)
const localeError = ref<string | null>(null)
function closeAddLocale() {
  addingLocale.value = false
  newLocale.value = ''
  localeError.value = null
}
function onAddLocale() {
  const raw = newLocale.value.trim()
  if (!raw) return
  if (locales.value.includes(raw.toLowerCase())) {
    localeError.value = `${raw.toLowerCase()} is already a locale`
    return
  }
  if (!addLocale(raw)) {
    localeError.value = 'A locale is a language code like fr, or a language-region pair like pt-br'
    return
  }
  closeAddLocale()
}


// --- seo ---

const ogImage = computed({
  get: () => settings.value.seo.ogImage ?? '',
  set: (v: string) => (settings.value.seo.ogImage = v || undefined),
})

// structured data (schema.org JSON-LD): written through computeds so an
// untouched project carries no `schema` key, and clearing a field deletes it
const schemaOn = computed(() => !!settings.value.seo.schema)
const schemaTypeOptions = [
  { label: 'None', value: '' },
  ...SCHEMA_TYPES.map((t) => ({ label: t === 'LocalBusiness' ? 'Local business' : t, value: t })),
]
const seoLogo = computed({
  get: () => settings.value.seo.logo ?? '',
  set: (v: string) => (settings.value.seo.logo = v || undefined),
})
function schemaField(key: 'custom') {
  return computed({
    get: () => settings.value.seo.schema?.[key] ?? '',
    set: (v: string) => {
      const sd = settings.value.seo.schema
      if (!sd) return
      if (v) sd[key] = v
      else delete sd[key]
    },
  })
}
// the type select is the switch: "None" removes the whole `schema` key so an
// untouched project stays byte-identical; picking a type creates it
const schemaType = computed({
  get: () => settings.value.seo.schema?.type ?? '',
  set: (v: StructuredDataType | '') => {
    if (!v) delete settings.value.seo.schema
    else if (settings.value.seo.schema) settings.value.seo.schema.type = v
    else settings.value.seo.schema = { type: v }
  },
})
const schemaCustom = schemaField('custom')
const schemaCustomError = computed(() => customSchemaError(schemaCustom.value))
const newSameAs = ref('')
const sameAs = computed(() => settings.value.seo.schema?.sameAs ?? [])
function addSameAs() {
  const url = newSameAs.value.trim()
  const sd = settings.value.seo.schema
  if (!sd || !/^https?:\/\//i.test(url) || sameAs.value.includes(url)) return
  ;(sd.sameAs ??= []).push(url)
  newSameAs.value = ''
}
function removeSameAs(url: string) {
  const sd = settings.value.seo.schema
  if (!sd?.sameAs) return
  sd.sameAs = sd.sameAs.filter((u) => u !== url)
  if (!sd.sameAs.length) delete sd.sameAs
}
// --- design ---

// --- type scale (settings.theme) ---
// Written through computeds so a blank field CLEARS the override rather than
// storing an empty string the compiler would silently drop.
function themeField(
  read: () => string | undefined,
  write: (v: string | undefined) => void,
) {
  return computed({
    get: () => read() ?? '',
    set: (v: string) => write(v.trim() || undefined),
  })
}
const ensureTheme = () => (settings.value.theme ??= {})
const themeRootFontSize = themeField(
  () => settings.value.theme?.rootFontSize,
  (v) => {
    const t = ensureTheme()
    if (v) t.rootFontSize = v
    else delete t.rootFontSize
  },
)
const themeSpacing = themeField(
  () => settings.value.theme?.spacing,
  (v) => {
    const t = ensureTheme()
    if (v) t.spacing = v
    else delete t.spacing
  },
)
const themeTextBase = themeField(
  () => settings.value.theme?.text?.base,
  (v) => {
    const t = ensureTheme()
    if (v) t.text = { ...(t.text ?? {}), base: v }
    else if (t.text) {
      delete t.text.base
      if (!Object.keys(t.text).length) delete t.text
    }
  },
)
/** which of the three fields hold something the compiler would discard */
const themeInvalid = computed(() =>
  (
    [
      ['Root size', themeRootFontSize.value],
      ['Body size', themeTextBase.value],
      ['Spacing unit', themeSpacing.value],
    ] as const
  )
    .filter(([, v]) => v && !isThemeValue(v))
    .map(([label]) => label),
)

const tokenError = (id: string, name: string) =>
  tokenNameError(
    name,
    settings.value.tokens.filter((t) => t.id !== id),
  )

const googleFontsUrl = computed({
  get: () => settings.value.fonts.googleFontsUrl ?? '',
  set: (v: string) => (settings.value.fonts.googleFontsUrl = v.trim() || undefined),
})

// --- custom webfonts ---

const { assetForSrc } = useMedia()

// --- add-font form: a local draft, committed as one entry ---
// the format() hint comes from the library asset's mime — assets are stored
// extensionless, so the URL alone can't tell us, and the exporter must not
// need the media index to emit the CSS
const addingFont = ref(false)
const fontDraft = ref({ src: '', family: '' })
// an unnamed draft takes its family from the filename ("OffSans.ttf" → OffSans)
watch(
  () => fontDraft.value.src,
  (src) => {
    const asset = assetForSrc(src)
    if (src && !fontDraft.value.family.trim() && asset?.name) {
      fontDraft.value.family = asset.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 -]/g, ' ').trim()
    }
  },
)
const fontDraftError = computed(() => {
  const d = fontDraft.value
  if (!d.src || !d.family.trim()) return null
  const err = fontError({ id: '', family: d.family, src: d.src }, customFonts.value)
  return err && !INCOMPLETE_FONT.has(err) ? err : null
})
function closeAddFont() {
  addingFont.value = false
  fontDraft.value = { src: '', family: '' }
}
function submitFont() {
  const d = fontDraft.value
  if (!d.src || !d.family.trim() || fontDraftError.value) return
  const asset = assetForSrc(d.src)
  addFont({
    family: d.family.trim(),
    src: d.src,
    format: (asset && fontFormatForMime(asset.mime)) || fontFormatForUrl(d.src),
  })
  closeAddFont()
}

/** the row's subline: the library file it points at */
function fontFileLabel(font: CustomFont) {
  const asset = assetForSrc(font.src)
  return asset ? `${asset.name}${font.format ? ` · ${font.format}` : ''}` : font.src
}

// the shared validator also reports a row that is merely unfinished (no name
// yet, no file yet) — only real problems are shown
const INCOMPLETE_FONT = new Set(['Family name required', 'Pick a font file'])
const fontIssue = (font: CustomFont) => {
  const err = fontError(font, customFonts.value)
  return err && !INCOMPLETE_FONT.has(err) ? err : null
}

/** families that actually resolve — offered as the base/mono/serif value so
 *  the user picks a registered font instead of retyping its name */
const customFamilyOptions = computed(() =>
  customFonts.value
    .filter((f) => !fontError(f, customFonts.value))
    .map((f) => f.family.trim())
    .filter((name, i, all) => name && all.indexOf(name) === i)
    .map((name) => ({ label: name, value: name })),
)

const familyOptions = computed(() => {
  const custom = customFamilyOptions.value
  return [
    { label: 'Default', value: '' },
    ...(custom.length ? custom : []),
    ...FONT_STACKS,
  ]
})

const monoFamily = computed({
  get: () => settings.value.fonts.monoFamily ?? '',
  set: (v: string) => (settings.value.fonts.monoFamily = v.trim() || undefined),
})
const serifFamily = computed({
  get: () => settings.value.fonts.serifFamily ?? '',
  set: (v: string) => (settings.value.fonts.serifFamily = v.trim() || undefined),
})

const legacyImported = ref(0)
function onImportLegacyFonts() {
  legacyImported.value = importLegacyHeadFonts()
}

// --- site ---

function normalizeDomain() {
  settings.value.domain = settings.value.domain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

const unpublishing = ref(false)
const unpublishError = ref<string | null>(null)
async function onUnpublish() {
  const ok = await confirm({
    title: 'Take the site down?',
    message:
      'Visitors get "Nothing published yet." until you publish again. Your pages are untouched — only the exported site is removed.',
    confirmLabel: 'Unpublish',
  })
  if (!ok) return
  unpublishing.value = true
  unpublishError.value = null
  try {
    await unpublish()
  } catch (e) {
    unpublishError.value = e instanceof Error ? e.message : 'Unpublish failed'
  } finally {
    unpublishing.value = false
  }
}

// --- publish method ---

const publishMethodOptions = [
  { label: 'Server', value: 'server' },
  { label: 'Download .zip', value: 'zip' },
  { label: 'GitHub', value: 'github' },
]

// GitHub token is write-only: the server never echoes it, we only learn
// whether one is set (on mount) and can replace it.
const ghTokenSet = ref(false)
const ghToken = ref('')
const ghSaving = ref(false)
const ghError = ref<string | null>(null)

onMounted(async () => {
  if (!canBuild.value) return
  try {
    const res = await fetch('/api/publish-config')
    if (res.ok) ghTokenSet.value = (await res.json())?.github?.tokenSet ?? false
  } catch {
    /* best-effort — leave ghTokenSet false */
  }
})

async function saveGhToken() {
  ghSaving.value = true
  ghError.value = null
  try {
    const res = await fetch('/api/publish-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ github: { token: ghToken.value } }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Save failed')
    ghTokenSet.value = (await res.json())?.github?.tokenSet ?? false
    ghToken.value = ''
  } catch (e) {
    ghError.value = e instanceof Error ? e.message : 'Save failed'
  } finally {
    ghSaving.value = false
  }
}

// --- apiOrigin: where a statically hosted page reaches this instance ---
//
// A zip/GitHub export is otherwise a self-contained static site, so the field
// is shown only once something in the project actually needs it: an ENABLED
// form, whose action has to post back here. Everything else about the export is
// root-relative, and asking every author for a studio URL to download a zip
// read as a step they had to complete.
//
// Validated here as well as at export: a typo would make every form on the
// published site post into nowhere, and the publish warning that catches that
// is one round trip later than the author.

/** an enabled form anywhere in the project — pages and component masters alike */
const hasEnabledForm = computed(() => {
  let found = false
  const look = (nodes: ElementNode[]) => walkNodes(nodes, (n) => {
    if (n.form?.enabled) found = true
  })
  for (const page of project.value.pages) look(page.elements)
  for (const def of project.value.components) look([def.root])
  return found
})

/** the zip/GitHub methods are served elsewhere; `server` IS this host */
const needsApiOrigin = computed(
  () => settings.value.publishing.method !== 'server' && hasEnabledForm.value,
)

const apiOriginError = ref<string | null>(null)
const apiOrigin = computed({
  get: () => settings.value.publishing.apiOrigin ?? '',
  set(next: string) {
    const trimmed = next.trim().replace(/\/+$/, '')
    settings.value.publishing.apiOrigin = trimmed
    apiOriginError.value = originError(trimmed)
  },
})

/** https:// with no path, or http:// for localhost only */
function originError(value: string): string | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'That is not a URL — include https://'
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return 'Use https:// — a form posts credentials-free, but in the clear otherwise'
  }
  if (url.pathname !== '/' && url.pathname !== '') return 'Just the origin, with no path'
  if (url.search || url.hash) return 'Just the origin, with no query or fragment'
  return null
}

// --- integrations: a named set of keys, stored server-side ---
//
// The values live in server/data/integrations.json and are reached over
// /api/integrations (useIntegrations). A SECRET key's value never arrives
// here — the server's read shape omits it — so a secret row is masked because
// there is nothing to show, not because the UI hides it.
//
// Writes are admin-only server-side, so the add/rename/delete affordances are
// gated on isAdmin: offering an editor a button that always 403s is worse than
// not offering it.

const {
  integrations,
  loaded: integrationsLoaded,
  loadError: integrationsLoadError,
  load: loadIntegrations,
  create: createIntegration,
  rename: renameIntegrationOnServer,
  remove: removeIntegration,
  setKey: setIntegrationKey,
  removeKey: removeIntegrationKey,
  test: testIntegration,
} = useIntegrations()

onMounted(() => {
  if (canBuild.value) loadIntegrations()
})

/** how custom code references a PLAIN key. Secrets get no reference: the
 *  exporter refuses to substitute one (it would print the credential into a
 *  <script> on a public page), so showing it would only invite the attempt. */
const refFor = (ig: Integration, f: IntegrationField) => envRef(ig.name, f.name)

/** which rows are open. An integration is a LIST ITEM that expands in place,
 *  so the panel stays one section however many there are — a section each put
 *  the keys of the fifth integration five screens down. */
const openIntegrations = ref(new Set<string>())
const isIntegrationOpen = (id: string) => openIntegrations.value.has(id)
function toggleIntegration(id: string) {
  if (openIntegrations.value.delete(id)) {
    // collapsing the row it belongs to would leave the form open but unreachable
    if (fieldAdding.value === id) closeAddField()
    openIntegrations.value = new Set(openIntegrations.value)
    return
  }
  openIntegrations.value = new Set(openIntegrations.value).add(id)
}

const addingIntegration = ref(false)
const integrationDraft = ref('')
const integrationError = ref<string | null>(null)
const integrationBusy = ref(false)
function closeAddIntegration() {
  addingIntegration.value = false
  integrationDraft.value = ''
  integrationError.value = null
}
async function submitIntegration() {
  const name = integrationDraft.value.trim()
  if (!name || integrationBusy.value) return
  const bad = integrationNameError(name)
  if (bad) {
    integrationError.value = bad
    return
  }
  integrationBusy.value = true
  try {
    const id = await createIntegration(name)
    // it has no keys yet, so open it on its empty state
    openIntegrations.value = new Set(openIntegrations.value).add(id)
    closeAddIntegration()
  } catch (e) {
    integrationError.value = e instanceof Error ? e.message : 'Could not add it'
  } finally {
    integrationBusy.value = false
  }
}

async function renameIntegration(ig: Integration) {
  const name = await openModal<string | undefined>(RenameModal, {
    title: 'Rename integration',
    value: ig.name,
    placeholder: 'SMTP, Stripe, Mailchimp…',
  })
  if (!name || name === ig.name) return
  try {
    await renameIntegrationOnServer(ig.id, name)
  } catch (e) {
    integrationError.value = e instanceof Error ? e.message : 'Rename failed'
  }
}

async function deleteIntegration(ig: Integration) {
  const ok = await confirm({
    title: 'Delete integration',
    message: `Delete ${ig.name} and its ${ig.fields.length} ${ig.fields.length === 1 ? 'key' : 'keys'}? Anything referencing them stops working.`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  try {
    await removeIntegration(ig.id)
  } catch (e) {
    integrationError.value = e instanceof Error ? e.message : 'Delete failed'
    return
  }
  openIntegrations.value.delete(ig.id)
  if (fieldAdding.value === ig.id) closeAddField()
}

const fieldAdding = ref<string | null>(null)
const fieldReplacing = ref<string | null>(null)
const fieldDraft = ref({ name: '', value: '', secret: true })
const fieldError = ref<string | null>(null)
const fieldBusy = ref(false)
function startAddField(ig: Integration) {
  openIntegrations.value = new Set(openIntegrations.value).add(ig.id)
  fieldAdding.value = ig.id
  fieldReplacing.value = null
  fieldDraft.value = { name: '', value: '', secret: true }
  fieldError.value = null
}
function startReplaceField(ig: Integration, f: IntegrationField) {
  openIntegrations.value = new Set(openIntegrations.value).add(ig.id)
  fieldAdding.value = ig.id
  fieldReplacing.value = f.name
  // a secret's value was never sent to us, so there is nothing to prefill
  fieldDraft.value = { name: f.name, value: f.secret ? '' : f.value ?? '', secret: f.secret }
  fieldError.value = null
}
function closeAddField() {
  fieldAdding.value = null
  fieldReplacing.value = null
  fieldDraft.value = { name: '', value: '', secret: true }
  fieldError.value = null
}
async function submitField(ig: Integration) {
  const name = normalizeKeyName(fieldDraft.value.name)
  const { value, secret } = fieldDraft.value
  if (!name || !value || fieldBusy.value) return
  const bad = keyNameError(name)
  if (bad) {
    fieldError.value = bad
    return
  }
  if (!fieldReplacing.value && ig.fields.some((f) => f.name === name)) {
    fieldError.value = `${name} already exists — edit it from the list`
    return
  }
  fieldBusy.value = true
  try {
    await setIntegrationKey(ig.id, name, value, secret)
    closeAddField()
  } catch (e) {
    fieldError.value = e instanceof Error ? e.message : 'Could not save it'
  } finally {
    fieldBusy.value = false
  }
}
async function deleteField(ig: Integration, f: IntegrationField) {
  const ok = await confirm({
    title: 'Delete key',
    message: `Delete ${f.name} from ${ig.name}?`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  try {
    await removeIntegrationKey(ig.id, f.name)
  } catch (e) {
    fieldError.value = e instanceof Error ? e.message : 'Delete failed'
  }
}

const savedPlaceholder = (isSet: boolean, hint: string) =>
  isSet ? 'Saved — enter to replace' : hint

const ghConfigured = computed(() => !!settings.value.publishing.github.repo && ghTokenSet.value)

// --- forms: recipients, who sends, how long leads are kept ---
//
// All of it server-side and admin-only. A recipient list in the project blob
// would let a draft, a merge or an injected agent redirect other people's
// leads; a retention window there would let them keep them forever.

const {
  config: formsConfig,
  forms: formList,
  loadConfig: loadFormsConfig,
  saveConfig: saveFormsConfig,
  loadForms: loadFormList,
} = useFormSubmissions()

const formsError = ref<string | null>(null)
const recipientDraft = ref('')

onMounted(async () => {
  if (!isAdmin.value) return
  try {
    await loadFormsConfig()
    await loadFormList()
  } catch (e) {
    formsError.value = e instanceof Error ? e.message : 'Could not load form settings'
  }
})

/** every integration is offered: the server checks the pick carries the keys
 *  the capability needs and refuses by name, which is a better error than a
 *  filtered list that silently omits the one the admin was looking for */
const integrationOptions = computed(() => [
  { label: 'None', value: '' },
  ...integrations.value.map((ig) => ({ label: ig.name, value: ig.id })),
])

async function patchForms(patch: Record<string, unknown>) {
  formsError.value = null
  try {
    await saveFormsConfig(patch)
  } catch (e) {
    formsError.value = e instanceof Error ? e.message : 'Could not save'
    // re-read so the UI shows what is actually stored, not the refused pick
    await loadFormsConfig().catch(() => {})
  }
}

async function addRecipient() {
  const email = recipientDraft.value.trim()
  if (!email) return
  await patchForms({ notifyTo: [...formsConfig.value.notifyTo, email] })
  if (!formsError.value) recipientDraft.value = ''
}

const removeRecipient = (email: string) =>
  patchForms({ notifyTo: formsConfig.value.notifyTo.filter((e) => e !== email) })

const testingCapability = ref<string | null>(null)
const testResult = ref<{ capability: string; ok: boolean; error?: string } | null>(null)

async function testPick(capability: 'smtp' | 'webhook') {
  const id = capability === 'smtp' ? formsConfig.value.mailer : formsConfig.value.webhook
  if (!id) return
  testingCapability.value = capability
  testResult.value = null
  try {
    const r = await testIntegration(id, capability)
    testResult.value = { capability, ...r }
  } catch (e) {
    testResult.value = {
      capability,
      ok: false,
      error: e instanceof Error ? e.message : 'Test failed',
    }
  } finally {
    testingCapability.value = null
  }
}

const totalSubmissions = computed(() => formList.value.reduce((n, f) => n + f.count, 0))

function openSubmissions(formId?: string) {
  openModal(FormSubmissionsModal, formId ? { formId } : {})
}

// --- snapshots: server-kept project packages (the export, listed) ---

type Snapshot = { id: string; createdAt: number; bytes: number; name: string }
const snapshots = ref<Snapshot[]>([])
const snapshotBusy = ref(false)
const snapshotError = ref<string | null>(null)

async function loadSnapshots() {
  try {
    const res = await fetch('/api/snapshots')
    if (res.ok) snapshots.value = await res.json()
  } catch {
    /* best-effort */
  }
}
onMounted(() => {
  if (isAdmin.value) loadSnapshots()
})

async function takeSnapshot() {
  if (snapshotBusy.value) return
  snapshotBusy.value = true
  snapshotError.value = null
  try {
    const res = await fetch('/api/snapshots', { method: 'POST' })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Snapshot failed')
    await loadSnapshots()
  } catch (e) {
    snapshotError.value = e instanceof Error ? e.message : 'Snapshot failed'
  } finally {
    snapshotBusy.value = false
  }
}

async function restoreSnapshot(snap: Snapshot) {
  const ok = await confirm({
    title: 'Restore this snapshot?',
    message: `Every page, draft, setting and media file goes back to how it was ${timeAgo(snap.createdAt)}, for every user. Take a snapshot first if you want to keep what is there now.`,
    confirmLabel: 'Restore',
  })
  if (!ok) return
  snapshotError.value = null
  try {
    const res = await fetch(`/api/snapshots/${snap.id}/restore`, { method: 'POST' })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Restore failed')
    location.reload()
  } catch (e) {
    snapshotError.value = e instanceof Error ? e.message : 'Restore failed'
  }
}

async function downloadSnapshot(snap: Snapshot) {
  snapshotError.value = null
  try {
    const res = await fetch(`/api/snapshots/${snap.id}`)
    if (!res.ok) throw new Error('Download failed')
    downloadBlob(await res.blob(), filenameFrom(res, `${snap.name || snap.id}.zip`))
  } catch (e) {
    snapshotError.value = e instanceof Error ? e.message : 'Download failed'
  }
}

// rename: the row's title turns into an input; Enter commits, Escape cancels
const renamingSnapshot = ref<string | null>(null)
const snapshotDraftName = ref('')
function startRenameSnapshot(snap: Snapshot) {
  renamingSnapshot.value = snap.id
  snapshotDraftName.value = snap.name
}
async function commitRenameSnapshot(snap: Snapshot) {
  const id = renamingSnapshot.value
  renamingSnapshot.value = null
  if (id !== snap.id) return
  const name = snapshotDraftName.value.trim()
  if (name === snap.name) return
  snap.name = name // optimistic; the list reload below is the truth
  await fetch(`/api/snapshots/${snap.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => {})
  await loadSnapshots()
}

async function deleteSnapshot(snap: Snapshot) {
  const ok = await confirm({
    title: 'Delete snapshot',
    message: `Delete the snapshot from ${new Date(snap.createdAt).toLocaleString()}? This cannot be undone.`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  await fetch(`/api/snapshots/${snap.id}`, { method: 'DELETE' }).catch(() => {})
  await loadSnapshots()
}

const importInput = ref<HTMLInputElement>()
const importing = ref(false)
const importError = ref<string | null>(null)
async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (importInput.value) importInput.value.value = '' // allow re-picking the same file
  if (!file) return
  const ok = await confirm({
    title: 'Replace entire project?',
    message:
      'Importing a package replaces ALL pages, branches, settings and media for every user. This cannot be undone.',
  })
  if (!ok) return
  importing.value = true
  importError.value = null
  try {
    const res = await fetch('/api/project-import', { method: 'POST', body: file })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Import failed')
    location.reload()
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Import failed'
    importing.value = false
  }
}
</script>

<template>
  <ModalHost size="xl" @close="emit('close')">
    <div class="flex h-full flex-col">
      <!-- top bar: [icon] [title] ——— [search] [close] -->
      <div class="flex shrink-0 items-center gap-2 border-b border-input py-2.5 pr-1.5 pl-4">
        <Settings class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-xs font-medium">Project settings</span>
        <div class="flex-1" />
        <div class="relative w-64">
          <Search
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            v-model="navQuery"
            type="text"
            spellcheck="false"
            placeholder="Search settings…"
            class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <ButtonUI variant="icon" size="sm" :icon="X" class="mr-1 w-7 text-muted-foreground" @click="emit('close')" />
      </div>

      <TabsUI v-model:active="active" class="flex min-h-0 min-w-0 flex-1 !flex-row !gap-0">
      <!-- left sidebar: grouped nav + pinned account footer -->
      <div class="flex w-48 shrink-0 flex-col border-r border-input">
        <nav class="custom-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          <p v-if="!filteredNav.length" class="px-2 py-1 text-[9px] text-muted-foreground">
            No matching settings.
          </p>
          <div v-for="group in filteredNav" :key="group.label" class="flex flex-col gap-0.5">
            <p class="px-2 pb-1 section-label">
              {{ group.label }}
            </p>
            <TabUI
              v-for="item in group.items"
              :key="item.id"
              :id="item.id"
              class="flex !h-8 !w-full items-center !justify-start !px-3 !text-left"
            >
              <span class="flex items-center gap-2">
                <component :is="item.icon" class="size-3.5 shrink-0" />
                {{ item.label }}
              </span>
            </TabUI>
          </div>
        </nav>
        <!-- user card: click to open the account tab -->
        <div class="flex items-center gap-2 border-t border-input p-2">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-accent/30"
            :class="active === 'account' ? 'bg-input' : ''"
            @click="active = 'account'"
          >
            <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <UserRound class="size-3.5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-medium">{{ authName || 'Your account' }}</span>
              <span class="block truncate text-[9px] text-muted-foreground">{{ authEmail }}</span>
            </span>
          </button>
        </div>
      </div>

      <!-- right pane: section content -->
      <!-- gutter reserved (inline: .custom-scrollbar is unlayered, so a utility
           can't override its `auto`) so a tab that scrolls doesn't shift the
           fields of one that doesn't -->
      <div
        class="custom-scrollbar min-w-0 flex-1 overflow-y-auto [&_[data-row]]:px-0"
        style="scrollbar-gutter: stable"
      >
        <div class="flex flex-col gap-9 p-6">
          <TabPanelUI class="gap-9" id="general">
            <SettingsGroup title="Project" description="Your project's name and browser-tab icon.">
              <RowUI label="Name">
                <InputUI v-model="projectName" placeholder="Untitled project" />
              </RowUI>
              <RowUI label="Favicon">
                <div class="flex items-start gap-3">
                  <IconTileUI
                    v-model="favicon"
                    label="Light"
                    accept="image/png,image/svg+xml,image/x-icon"
                  />
                  <IconTileUI
                    v-model="faviconDark"
                    label="Dark"
                    accept="image/png,image/svg+xml,image/x-icon"
                  />
                </div>
              </RowUI>
            </SettingsGroup>
            <SettingsGroup
              v-if="canBuild"
              title="Private site"
              description="Visitors need a password before they see the site."
            >
              <template #action>
                <ToggleUI :model-value="siteGate.enabled" @update:model-value="setSiteGateEnabled" />
              </template>
              <RowUI v-if="siteGate.enabled" label="Password">
                <div class="flex w-full gap-1.5">
                  <InputUI
                    v-model="sitePasswordInput"
                    type="password"
                    :placeholder="savedPlaceholder(siteGate.passwordSet, 'At least 4 characters')"
                    @keydown.enter="saveSitePassword"
                  />
                  <ButtonUI
                    variant="outline"
                    size="xs"
                    class="!h-7 px-2.5"
                    :disabled="siteGateBusy || !sitePasswordInput"
                    @click="saveSitePassword"
                  >
                    {{ siteGateBusy ? 'Saving…' : 'Save' }}
                  </ButtonUI>
                </div>
              </RowUI>
              <p v-if="siteGateError" class="text-[10px] text-danger">{{ siteGateError }}</p>
            </SettingsGroup>
            <SettingsGroup
              v-if="canBuild"
              title="Smooth scrolling"
              description="Inertia scrolling on Play and the published site."
            >
              <template #action>
                <ToggleUI v-model="smoothScroll.enabled" />
              </template>
              <RowUI v-if="smoothScroll.enabled" label="Intensity">
                <SliderUI v-model="scrollLerp" :min="SCROLL_LERP_MIN" :max="SCROLL_LERP_MAX" :step="0.01" />
                <span class="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {{ scrollLerp.toFixed(2) }}
                </span>
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="seo">
            <SettingsGroup
              title="Search & social"
              description="Site-wide defaults; %s in the title is the page name."
            >
              <RowUI label="Logo" align="start">
                <IconTileUI v-model="seoLogo" />
              </RowUI>
              <RowUI label="Site name">
                <InputUI v-model="settings.seo.siteName" placeholder="My Site" />
              </RowUI>
              <RowUI v-if="canBuild" label="Domain">
                <InputUI
                  v-model="settings.domain"
                  placeholder="example.com"
                  class="font-mono"
                  @blur="normalizeDomain"
                />
              </RowUI>
              <RowUI label="Title">
                <InputUI v-model="settings.seo.titleTemplate" placeholder="%s — My Site" />
              </RowUI>
              <RowUI label="Description" align="start">
                <TextareaUI v-model="settings.seo.description" placeholder="Shown in search results" :rows="2" />
              </RowUI>
              <!-- structured data (schema.org JSON-LD): "None" turns it off -->
              <RowUI label="Schema">
                <SelectUI v-model="schemaType" :options="schemaTypeOptions" />
              </RowUI>
              <RowUI v-if="schemaOn" label="Profiles">
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div v-if="sameAs.length" class="flex flex-wrap gap-1">
                    <BadgeUI v-for="u in sameAs" :key="u" removable @remove="removeSameAs(u)">
                      {{ u.replace(/^https?:\/\/(www\.)?/, '') }}
                    </BadgeUI>
                  </div>
                  <div class="flex gap-1.5">
                    <InputUI
                      v-model="newSameAs"
                      placeholder="https://instagram.com/…"
                      class="font-mono"
                      @keydown.enter="addSameAs"
                    />
                    <ButtonUI variant="outline" size="xs" class="!h-7 px-2.5" :icon="Plus" @click="addSameAs">Add</ButtonUI>
                  </div>
                </div>
              </RowUI>
              <RowUI label="OG image" align="start">
                <IconTileUI v-model="ogImage" wide />
              </RowUI>
              <RowUI v-if="schemaOn" label="JSON-LD" align="start">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <TextareaUI
                    v-model="schemaCustom"
                    placeholder='{ "@type": "LocalBusiness", "telephone": "+1 …" }'
                    :rows="4"
                    class="font-mono"
                  />
                  <p v-if="schemaCustomError" class="text-[9px] text-danger">{{ schemaCustomError }}</p>
                  <p v-else class="text-[9px] text-muted-foreground">
                    Optional. One object or an array, added after the generated entries.
                  </p>
                </div>
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="design">
            <SettingsGroup
              title="Design tokens"
              description="Project colors, used as bg-<name>, text-<name>, border-<name>."
            >
              <template #action>
                <ButtonUI size="xs" :icon="Plus" @click="addToken()">Add token</ButtonUI>
              </template>

              <div v-for="token in settings.tokens" :key="token.id" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1.5">
                  <InputUI v-model="token.name" placeholder="brand" class="font-mono" />
                  <ColorPickerUI v-model="token.value" output="hex" />
                  <ButtonUI variant="ghost" size="xs" :icon="Trash2" @click="removeToken(token.id)" />
                </div>
                <p v-if="tokenError(token.id, token.name)" class="text-[9px] text-danger">
                  {{ tokenError(token.id, token.name) }}
                </p>
                <p
                  v-else-if="tokenNameNote(token.name)"
                  class="text-[9px] text-pending"
                >
                  {{ tokenNameNote(token.name) }}
                </p>
              </div>
              <EmptyListUI v-if="!settings.tokens.length">No tokens yet.</EmptyListUI>
            </SettingsGroup>

            <SettingsGroup
              title="Type scale"
              description="Override the default scale. Blank keeps the default."
            >
              <RowUI label="Root size">
                <InputUI
                  v-model="themeRootFontSize"
                  placeholder="16px"
                  class="font-mono"
                />
              </RowUI>
              <RowUI label="Body size">
                <InputUI v-model="themeTextBase" placeholder="1rem" class="font-mono" />
              </RowUI>
              <RowUI label="Spacing unit">
                <InputUI v-model="themeSpacing" placeholder="0.25rem" class="font-mono" />
              </RowUI>
              <p v-if="themeInvalid.length" class="px-1 text-[9px] text-danger">
                Not a CSS length: {{ themeInvalid.join(', ') }}
              </p>
              <p v-else-if="settings.theme?.rootFontSize" class="px-1 text-[9px] text-muted-foreground">
                The root size applies exactly on the published site. In the editor it is scoped to
                the canvas so it can't resize the editor itself, so rem-based spacing previews at
                the default there.
              </p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="fonts">
            <!-- fonts hand-written into the head code render on the published
                 site but NOT in the editor/preview (head code is exporter-only),
                 which is exactly the bug this tab exists to end. Offer the
                 conversion; never rewrite their code behind their back. -->
            <SettingsGroup
              v-if="legacyHeadFonts.length"
              title="Fonts found in your head code"
              description="These @font-face rules never reach the editor. Import them."
            >
              <div class="flex flex-col divide-y divide-input rounded-xl border border-input">
                <div
                  v-for="(f, i) in legacyHeadFonts"
                  :key="`${f.family}-${i}`"
                  class="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span class="text-xs font-medium">{{ f.family }}</span>
                  <span class="truncate font-mono text-[9px] text-muted-foreground">{{ f.src }}</span>
                </div>
              </div>
              <ButtonUI variant="outline" size="sm" class="w-full" @click="onImportLegacyFonts">
                Import {{ legacyHeadFonts.length }} font{{ legacyHeadFonts.length === 1 ? '' : 's' }}
              </ButtonUI>
            </SettingsGroup>

            <SettingsGroup
              v-else-if="legacyImported"
              title="Fonts imported"
              description="Imported — the @font-face rules in your head code are redundant."
            >
              <ButtonUI variant="outline" size="sm" class="w-full" @click="clearLegacyHeadFonts">
                Remove them from the head code
              </ButtonUI>
            </SettingsGroup>

            <SettingsGroup
              title="Custom fonts"
              description="Font files from the library, under a family name."
            >
              <template #action>
                <ButtonUI
                  size="xs"
                  :variant="addingFont ? 'outline' : 'default'"
                  :icon="addingFont ? X : Plus"
                  @click="addingFont ? closeAddFont() : (addingFont = true)"
                >
                  {{ addingFont ? 'Close' : 'Add font' }}
                </ButtonUI>
              </template>

              <!-- inline add form (before the list), like Users' add form -->
              <div v-if="addingFont" class="flex flex-col gap-2 rounded-xl border border-input p-3">
                <RowUI label="File" align="start">
                  <MediaPickerControl v-model="fontDraft.src" kind="font" compact class="min-w-0 flex-1" />
                </RowUI>
                <RowUI label="Family">
                  <InputUI v-model="fontDraft.family" placeholder="OffSans" @keydown.enter="submitFont" />
                </RowUI>
                <p v-if="fontDraftError" class="text-[9px] text-danger">{{ fontDraftError }}</p>
                <div class="flex justify-end gap-1.5">
                  <ButtonUI variant="outline" size="xs" @click="closeAddFont">Cancel</ButtonUI>
                  <ButtonUI size="xs" :disabled="!fontDraft.src || !fontDraft.family.trim()" @click="submitFont">
                    Add font
                  </ButtonUI>
                </div>
              </div>

              <!-- registered fonts, laid out like the members list -->
              <div v-if="customFonts.length" class="flex flex-col rounded-xl border border-input">
                <div
                  v-for="font in customFonts"
                  :key="font.id"
                  class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    :class="fontIssue(font) ? 'bg-danger' : 'bg-success'"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium" :style="{ fontFamily: fontIssue(font) ? undefined : `'${font.family}'` }">
                      {{ font.family || 'Unnamed' }}
                    </p>
                    <p class="truncate text-[9px]" :class="fontIssue(font) ? 'text-danger' : 'text-muted-foreground'">
                      {{ fontIssue(font) ?? fontFileLabel(font) }}
                    </p>
                  </div>
                  <span v-if="!fontIssue(font)" class="shrink-0 font-mono text-[9px] text-muted-foreground">
                    font-[{{ font.family.trim().replace(/ /g, '_') }}]
                  </span>
                  <MenuUI>
                    <template #default="{ close }">
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
                        @click="(removeFont(font.id), close())"
                      >
                        <Trash2 class="size-3.5" /> Remove
                      </button>
                    </template>
                  </MenuUI>
                </div>
              </div>
              <EmptyListUI v-else>No custom fonts yet — the site uses the stacks below.</EmptyListUI>
            </SettingsGroup>

            <SettingsGroup
              title="Google Fonts"
              description="A hosted stylesheet, loaded on every page."
            >
              <RowUI label="URL">
                <InputUI
                  v-model="googleFontsUrl"
                  placeholder="https://fonts.googleapis.com/css2?…"
                  class="font-mono"
                />
              </RowUI>
            </SettingsGroup>

            <SettingsGroup
              title="Typography"
              description="The default family, and what font-mono / font-serif resolve to."
            >
              <RowUI label="Base">
                <SelectUI v-model="settings.fonts.family" :options="familyOptions" />
              </RowUI>
              <RowUI label="Serif">
                <SelectUI v-model="serifFamily" :options="familyOptions" />
              </RowUI>
              <RowUI label="Mono">
                <SelectUI v-model="monoFamily" :options="familyOptions" />
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="locales">
            <SettingsGroup
              title="Locales"
              description="Languages your site is translated into."
            >
              <template #action>
                <ButtonUI
                  size="xs"
                  :variant="addingLocale ? 'outline' : 'default'"
                  :icon="addingLocale ? X : Plus"
                  @click="addingLocale ? closeAddLocale() : (addingLocale = true)"
                >
                  {{ addingLocale ? 'Close' : 'Add locale' }}
                </ButtonUI>
              </template>

              <!-- inline add form (before the list), like Users' add form -->
              <div v-if="addingLocale" class="flex flex-col gap-2 rounded-xl border border-input p-3">
                <RowUI label="Code">
                  <InputUI v-model="newLocale" placeholder="fr, pt-br, zh-hant" class="font-mono" @keydown.enter="onAddLocale" />
                </RowUI>
                <p v-if="localeError" class="text-[9px] text-danger">{{ localeError }}</p>
                <div class="flex justify-end gap-1.5">
                  <ButtonUI variant="outline" size="xs" @click="closeAddLocale">Cancel</ButtonUI>
                  <ButtonUI size="xs" :disabled="!newLocale.trim()" @click="onAddLocale">Add locale</ButtonUI>
                </div>
              </div>

              <div class="flex flex-col rounded-xl border border-input">
                <div
                  v-for="l in locales"
                  :key="l"
                  class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
                >
                  <span class="size-1.5 shrink-0 rounded-full" :class="l === defaultLocale ? 'bg-success' : 'bg-muted-foreground/40'" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-mono text-xs font-medium">{{ l }}</p>
                    <p class="truncate text-[9px] text-muted-foreground">
                      <template v-if="l === defaultLocale">Default — holds the base content</template>
                      <template v-else>Falls back to {{ defaultLocale }} where untranslated</template>
                    </p>
                  </div>
                  <BadgeUI v-if="l === defaultLocale">default</BadgeUI>
                  <MenuUI v-else>
                    <template #default="{ close }">
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
                        @click="(setDefaultLocale(l), close())"
                      >
                        <Check class="size-3.5" /> Make default
                      </button>
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
                        @click="(confirmDeleteLocale(l), close())"
                      >
                        <Trash2 class="size-3.5" /> Delete
                      </button>
                    </template>
                  </MenuUI>
                </div>
              </div>
              <p class="text-[9px] text-muted-foreground">
                Changing the default does not move content between locales.
              </p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="publish">
            <SettingsGroup
              title="Publish method"
              description="How the Publish button ships your site."
            >
              <RowUI label="Method">
                <SelectUI v-model="settings.publishing.method" :options="publishMethodOptions" />
              </RowUI>
            </SettingsGroup>

            <SettingsGroup
              v-if="needsApiOrigin"
              title="Site backend"
              description="Where this site's forms reach this instance."
            >
              <template #action>
                <span
                  class="shrink-0 text-[9px]"
                  :class="apiOriginError ? 'text-danger' : apiOrigin ? 'text-success' : 'text-muted-foreground'"
                >
                  {{ apiOriginError ? 'Invalid' : apiOrigin ? 'Set' : 'Not set' }}
                </span>
              </template>
              <RowUI label="Studio URL">
                <InputUI
                  v-model="apiOrigin"
                  placeholder="https://studio.example.com"
                  class="font-mono"
                />
              </RowUI>
              <p v-if="apiOriginError" class="text-[9px] text-danger">{{ apiOriginError }}</p>
              <p class="text-[9px] text-muted-foreground">
                This site has a form, and a downloaded or pushed site is static files — so
                submissions post back here. This is the public address of this instance. Leave it
                empty if the site is served from this host.
              </p>
            </SettingsGroup>

            <SettingsGroup
              v-if="settings.publishing.method === 'github'"
              title="GitHub"
              description="The repository branch the exported site is pushed to."
            >
              <template #action>
                <span class="shrink-0 text-[9px]" :class="ghConfigured ? 'text-success' : 'text-muted-foreground'">
                  {{ ghConfigured ? 'Configured' : 'Not configured' }}
                </span>
              </template>
              <RowUI label="Repository">
                <InputUI v-model="settings.publishing.github.repo" placeholder="owner/name" class="font-mono" />
              </RowUI>
              <RowUI label="Branch">
                <InputUI v-model="settings.publishing.github.branch" placeholder="main" class="font-mono" />
              </RowUI>
              <RowUI label="Token">
                <div class="flex w-full gap-1.5">
                  <InputUI
                    v-model="ghToken"
                    type="password"
                    :placeholder="savedPlaceholder(ghTokenSet, 'ghp_…')"
                    class="font-mono"
                  />
                  <ButtonUI variant="outline" size="xs" class="!h-7 px-2.5" :disabled="ghSaving || !ghToken" @click="saveGhToken">
                    {{ ghSaving ? 'Saving…' : 'Save' }}
                  </ButtonUI>
                </div>
              </RowUI>
              <p class="text-[9px] text-muted-foreground">
                The branch is fully replaced on every publish — a root README or CNAME would be
                deleted. The token is kept on the server, never in the project file or an export.
              </p>
              <p v-if="ghError" class="text-[9px] text-danger">{{ ghError }}</p>
            </SettingsGroup>

            <SettingsGroup title="Status" description="The last build of the static site from Main.">
              <div class="flex flex-col rounded-xl border border-input">
                <div class="flex items-center gap-2 px-3 py-2">
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    :class="publishedInfo ? 'bg-success' : 'bg-pending'"
                  />
                  <div class="min-w-0 flex-1">
                    <template v-if="publishedInfo">
                      <p class="truncate text-xs font-medium">Published {{ timeAgo(publishedInfo.publishedAt) }}</p>
                      <p class="truncate text-[10px] text-muted-foreground">
                        {{ publishedInfo.routes }} routes · {{ formatBytes(publishedInfo.bytes) }}
                        <template v-if="publishedInfo.commit"> · {{ publishedInfo.commit.slice(0, 7) }}</template>
                      </p>
                    </template>
                    <template v-else>
                      <p class="truncate text-xs font-medium">Not published</p>
                      <p class="truncate text-[10px] text-muted-foreground">Visitors see nothing until you publish.</p>
                    </template>
                  </div>
                  <span v-if="!onMain" class="shrink-0 text-[10px] text-pending">
                    On a draft — publishing ships Main
                  </span>
                  <ButtonUI
                    v-if="publishedInfo"
                    variant="outline"
                    size="xs"
                    class="hover:!text-danger"
                    :disabled="unpublishing"
                    @click="onUnpublish"
                  >
                    {{ unpublishing ? 'Removing…' : 'Unpublish' }}
                  </ButtonUI>
                  <ButtonUI v-else size="xs" :icon="Rocket" @click="openModal(PublishDialog)">Publish</ButtonUI>
                </div>
              </div>
              <p v-if="unpublishError" class="text-[10px] text-danger">{{ unpublishError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-9" id="code">
            <SettingsGroup
              title="Custom code"
              description="Raw HTML on every exported page. Export only."
            >
              <RowUI label="Head" align="start">
                <TextareaUI
                  v-model="settings.customCode.head"
                  :rows="8"
                  class="font-mono"
                  placeholder="Inside <head> — analytics, meta tags, styles…"
                />
              </RowUI>
              <RowUI label="Body" align="start">
                <TextareaUI
                  v-model="siteBodyCode"
                  :rows="8"
                  class="font-mono"
                  placeholder="Before </body> — widgets, noscript tags…"
                />
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="integrations">
            <SettingsGroup
              title="Integrations"
              description="Each one is a named set of keys, secret or plain."
            >
              <template v-if="isAdmin" #action>
                <ButtonUI
                  size="xs"
                  :variant="addingIntegration ? 'outline' : 'default'"
                  :icon="addingIntegration ? X : Plus"
                  @click="addingIntegration ? closeAddIntegration() : (addingIntegration = true)"
                >
                  {{ addingIntegration ? 'Close' : 'Add integration' }}
                </ButtonUI>
              </template>

              <p v-if="integrationsLoadError" class="text-[10px] text-danger">
                {{ integrationsLoadError }}
              </p>

              <!-- new integration: just a name; its fields are added on its card -->
              <div v-if="addingIntegration" class="flex flex-col gap-2 rounded-xl border border-input p-3">
                <RowUI label="Name">
                  <InputUI v-model="integrationDraft" placeholder="SMTP, Stripe, Mailchimp…" @keydown.enter="submitIntegration" />
                </RowUI>
                <p v-if="integrationError" class="text-[10px] text-danger">{{ integrationError }}</p>
                <div class="flex justify-end gap-1.5">
                  <ButtonUI variant="outline" size="xs" @click="closeAddIntegration">Cancel</ButtonUI>
                  <ButtonUI
                    size="xs"
                    :disabled="!integrationDraft.trim() || integrationBusy"
                    @click="submitIntegration"
                  >
                    {{ integrationBusy ? 'Adding…' : 'Add integration' }}
                  </ButtonUI>
                </div>
              </div>

              <!-- one row per integration, expanding in place to show its keys -->
              <div v-if="integrations.length" class="flex flex-col rounded-xl border border-input">
                <div v-for="ig in integrations" :key="ig.id" class="border-b border-input last:border-b-0">
                  <div
                    class="flex cursor-pointer items-center gap-2 px-3 py-2 select-none"
                    @click="toggleIntegration(ig.id)"
                  >
                    <ChevronRight
                      class="size-3.5 shrink-0 text-muted-foreground transition-transform"
                      :class="isIntegrationOpen(ig.id) && 'rotate-90'"
                    />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-medium">{{ ig.name }}</p>
                      <p class="truncate text-[10px] text-muted-foreground">
                        {{ ig.fields.length }} {{ ig.fields.length === 1 ? 'key' : 'keys' }}
                      </p>
                    </div>
                    <div v-if="isAdmin" class="flex shrink-0 items-center gap-1.5" @click.stop>
                      <ButtonUI
                        size="xs"
                        :variant="fieldAdding === ig.id ? 'outline' : 'default'"
                        :icon="fieldAdding === ig.id ? X : Plus"
                        @click="fieldAdding === ig.id ? closeAddField() : startAddField(ig)"
                      >
                        {{ fieldAdding === ig.id ? 'Close' : 'Add key' }}
                      </ButtonUI>
                      <MenuUI>
                        <template #default="{ close }">
                          <button
                            type="button"
                            class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
                            @click="(renameIntegration(ig), close())"
                          >
                            <Pencil class="size-3.5" /> Rename
                          </button>
                          <button
                            type="button"
                            class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
                            @click="(deleteIntegration(ig), close())"
                          >
                            <Trash2 class="size-3.5" /> Delete
                          </button>
                        </template>
                      </MenuUI>
                    </div>
                  </div>

                  <div
                    v-if="isIntegrationOpen(ig.id)"
                    class="flex flex-col gap-2 border-t border-input px-3 py-2.5"
                  >
                    <!-- inline add / replace form, like Users' add form -->
                    <div v-if="fieldAdding === ig.id" class="flex flex-col gap-2 rounded-xl border border-input p-3">
                      <RowUI label="Key">
                        <InputUI
                          v-model="fieldDraft.name"
                          placeholder="HOST, PORT, API_KEY…"
                          class="font-mono uppercase"
                          :disabled="!!fieldReplacing"
                          @keydown.enter="submitField(ig)"
                        />
                      </RowUI>
                      <RowUI label="Value">
                        <InputUI
                          v-model="fieldDraft.value"
                          :type="fieldDraft.secret ? 'password' : 'text'"
                          :placeholder="fieldDraft.secret ? 'Never shown again once saved' : 'smtp.example.com'"
                          class="font-mono"
                          @keydown.enter="submitField(ig)"
                        />
                      </RowUI>
                      <RowUI label="Secret">
                        <ToggleUI v-model="fieldDraft.secret" :disabled="!!fieldReplacing" />
                        <span class="text-[10px] text-muted-foreground">
                          {{
                            fieldReplacing
                              ? 'Delete the key and add it again to change this'
                              : fieldDraft.secret
                                ? 'Server-side only — never shown again, never in an export'
                                : 'Readable here and substituted into custom code'
                          }}
                        </span>
                      </RowUI>
                      <p v-if="fieldError" class="text-[10px] text-danger">{{ fieldError }}</p>
                      <div class="flex justify-end gap-1.5">
                        <ButtonUI variant="outline" size="xs" @click="closeAddField">Cancel</ButtonUI>
                        <ButtonUI
                          size="xs"
                          :disabled="!fieldDraft.name.trim() || !fieldDraft.value || fieldBusy"
                          @click="submitField(ig)"
                        >
                          {{ fieldBusy ? 'Saving…' : fieldReplacing ? 'Replace value' : 'Add key' }}
                        </ButtonUI>
                      </div>
                    </div>

                    <div v-if="ig.fields.length" class="flex flex-col rounded-xl border border-input">
                      <div
                        v-for="f in ig.fields"
                        :key="f.name"
                        class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
                      >
                        <span class="size-1.5 shrink-0 rounded-full bg-success" />
                        <div class="min-w-0 flex-1">
                          <p class="truncate font-mono text-xs font-medium">{{ f.name }}</p>
                          <p class="truncate text-[10px] text-muted-foreground">
                            <template v-if="f.secret">
                              Secret · set {{ timeAgo(f.updatedAt) }} · used by server features only
                            </template>
                            <template v-else>
                              Plain · set {{ timeAgo(f.updatedAt) }} ·
                              <span class="font-mono">{{ refFor(ig, f) }}</span>
                            </template>
                          </p>
                        </div>
                        <span class="max-w-40 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                          {{ f.secret ? '••••••••' : f.value }}
                        </span>
                        <MenuUI v-if="isAdmin">
                          <template #default="{ close }">
                            <button
                              type="button"
                              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
                              @click="(startReplaceField(ig, f), close())"
                            >
                              <Pencil class="size-3.5" /> {{ f.secret ? 'Replace value' : 'Edit' }}
                            </button>
                            <button
                              type="button"
                              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
                              @click="(deleteField(ig, f), close())"
                            >
                              <Trash2 class="size-3.5" /> Delete
                            </button>
                          </template>
                        </MenuUI>
                      </div>
                    </div>
                    <EmptyListUI v-else-if="fieldAdding !== ig.id">No keys yet.</EmptyListUI>
                  </div>
                </div>
              </div>

              <EmptyListUI v-else-if="!addingIntegration && integrationsLoaded">
                {{
                  isAdmin
                    ? 'No integrations yet — add one and give it its keys.'
                    : 'No integrations yet — an admin sets these up.'
                }}
              </EmptyListUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-9" id="forms">
            <SettingsGroup
              title="Submissions"
              description="What visitors sent through the forms on your site."
            >
              <template #action>
                <ButtonUI size="xs" :icon="Inbox" @click="openSubmissions()">Open</ButtonUI>
              </template>
              <div v-if="formList.length" class="flex flex-col rounded-xl border border-input">
                <button
                  v-for="form in formList"
                  :key="form.formId"
                  type="button"
                  class="flex items-center gap-2 border-b border-input px-3 py-2 text-left outline-none last:border-b-0 hover:bg-accent/20"
                  @click="openSubmissions(form.formId)"
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    :class="form.storageFull ? 'bg-danger' : form.count ? 'bg-success' : 'bg-pending'"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium">{{ form.name }}</p>
                    <p class="truncate text-[10px] text-muted-foreground">
                      {{ form.count }} {{ form.count === 1 ? 'submission' : 'submissions' }}
                      <template v-if="form.latestAt"> · {{ timeAgo(form.latestAt) }}</template>
                      <template v-if="!form.onSite"> · no longer on the site</template>
                    </p>
                  </div>
                </button>
              </div>
              <EmptyListUI v-else>
                No forms yet — add a form to a page and turn on Accept submissions.
              </EmptyListUI>
            </SettingsGroup>

            <SettingsGroup
              title="Email notification"
              description="Who hears about a new submission, and what sends it."
            >
              <RowUI label="Send with">
                <SelectUI
                  :options="integrationOptions"
                  :model-value="formsConfig.mailer"
                  @update:model-value="(v) => patchForms({ mailer: v ?? '' })"
                />
              </RowUI>
              <p class="text-[9px] text-muted-foreground">
                An integration with HOST, PORT, USER, PASSWORD and FROM. Every transactional mail
                provider speaks SMTP, so any of them works.
              </p>
              <RowUI v-if="formsConfig.mailer" label="Test">
                <ButtonUI
                  variant="outline"
                  size="xs"
                  :icon="Mail"
                  :disabled="testingCapability === 'smtp'"
                  @click="testPick('smtp')"
                >
                  {{ testingCapability === 'smtp' ? 'Connecting…' : 'Send test' }}
                </ButtonUI>
                <span
                  v-if="testResult?.capability === 'smtp'"
                  class="text-[10px]"
                  :class="testResult.ok ? 'text-success' : 'text-danger'"
                >
                  {{ testResult.ok ? 'Connected and signed in' : testResult.error }}
                </span>
              </RowUI>

              <RowUI label="Recipients">
                <div class="flex w-full gap-1.5">
                  <InputUI
                    v-model="recipientDraft"
                    placeholder="leads@example.com"
                    @keydown.enter="addRecipient"
                  />
                  <ButtonUI
                    variant="outline"
                    size="xs"
                    class="!h-7 px-2.5"
                    :disabled="!recipientDraft.trim() || formsConfig.notifyTo.length >= 5"
                    @click="addRecipient"
                  >
                    Add
                  </ButtonUI>
                </div>
              </RowUI>
              <div v-if="formsConfig.notifyTo.length" class="flex flex-col rounded-xl border border-input">
                <div
                  v-for="email in formsConfig.notifyTo"
                  :key="email"
                  class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
                >
                  <span class="min-w-0 flex-1 truncate font-mono text-[10px]">{{ email }}</span>
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="X"
                    class="w-6 shrink-0 text-muted-foreground"
                    @click="removeRecipient(email)"
                  />
                </div>
              </div>
              <p v-else class="text-[9px] text-muted-foreground">
                Up to five. A form with notification on and no recipient here sends nothing.
              </p>
            </SettingsGroup>

            <SettingsGroup
              title="Forward to a webhook"
              description="Send every submission on to another service."
            >
              <RowUI label="Send with">
                <SelectUI
                  :options="integrationOptions"
                  :model-value="formsConfig.webhook"
                  @update:model-value="(v) => patchForms({ webhook: v ?? '' })"
                />
              </RowUI>
              <p class="text-[9px] text-muted-foreground">
                An integration with FORWARD_URL (https), and optionally FORWARD_AUTH, sent as the
                Authorization header. This is how a submission reaches Zapier, Airtable, a CRM or a
                newsletter provider — no per-service setup needed.
              </p>
              <RowUI v-if="formsConfig.webhook" label="Test">
                <ButtonUI
                  variant="outline"
                  size="xs"
                  :icon="Webhook"
                  :disabled="testingCapability === 'webhook'"
                  @click="testPick('webhook')"
                >
                  {{ testingCapability === 'webhook' ? 'Posting…' : 'Send test' }}
                </ButtonUI>
                <span
                  v-if="testResult?.capability === 'webhook'"
                  class="text-[10px]"
                  :class="testResult.ok ? 'text-success' : 'text-danger'"
                >
                  {{ testResult.ok ? 'The webhook answered' : testResult.error }}
                </span>
              </RowUI>
            </SettingsGroup>

            <SettingsGroup title="Retention" description="How long submissions are kept.">
              <RowUI label="Keep for">
                <InputUI
                  type="number"
                  :model-value="String(formsConfig.retentionDays)"
                  placeholder="365"
                  @update:model-value="(v) => patchForms({ retentionDays: Number(v) || 0 })"
                />
                <span class="text-[10px] text-muted-foreground">days</span>
              </RowUI>
              <p class="text-[9px] text-muted-foreground">
                Older submissions are deleted automatically, at startup and once a day. 0 keeps
                them forever. These are other people's names and messages, so keeping them no
                longer than you need is the point.
              </p>
              <p class="text-[9px] text-muted-foreground">
                {{ totalSubmissions }} stored right now. Submissions are not part of a project
                backup — download the CSV if you need a copy.
              </p>
              <p v-if="formsError" class="text-[10px] text-danger">{{ formsError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="mcp">
            <SettingsGroup
              title="MCP access"
              description="Tokens for the MCP server. Treat them like passwords."
            >
              <template #action>
                <ButtonUI
                  size="xs"
                  :variant="addingToken ? 'outline' : 'default'"
                  :icon="addingToken ? X : Plus"
                  @click="addingToken ? closeAddToken() : (addingToken = true)"
                >
                  {{ addingToken ? 'Close' : 'Add token' }}
                </ButtonUI>
              </template>

              <!-- inline create form (before the list), like Users' add form -->
              <div v-if="addingToken" class="flex flex-col gap-2 rounded-xl border border-input p-3">
                <!-- step 1: name it -->
                <template v-if="!freshApiToken">
                  <RowUI label="Name">
                    <InputUI v-model="apiTokenName" placeholder="e.g. mcp-laptop" @keydown.enter="onCreateToken" />
                  </RowUI>
                  <p v-if="apiTokenError" class="text-[9px] text-danger">{{ apiTokenError }}</p>
                  <div class="flex justify-end gap-1.5">
                    <ButtonUI variant="outline" size="xs" @click="closeAddToken">Cancel</ButtonUI>
                    <ButtonUI size="xs" :disabled="apiTokenBusy" @click="onCreateToken">
                      {{ apiTokenBusy ? 'Creating…' : 'Create token' }}
                    </ButtonUI>
                  </div>
                </template>

                <!-- step 2: show-once raw token -->
                <template v-else>
                  <p class="flex items-center gap-1.5 text-xs">
                    <Check class="size-3.5 shrink-0 text-success" />
                    <span class="font-medium">{{ freshApiName }}</span>
                    <span class="text-muted-foreground">· created</span>
                  </p>
                  <code class="block rounded-lg bg-input px-2 py-1.5 font-mono text-[9px] break-all select-all">
                    {{ freshApiToken }}
                  </code>
                  <ButtonUI :icon="apiTokenCopied ? Check : Copy" size="sm" class="w-full justify-center" @click="copyToken">
                    {{ apiTokenCopied ? 'Copied to clipboard' : 'Copy token' }}
                  </ButtonUI>
                  <p class="text-[9px] text-muted-foreground">Copy it now — it won't be shown again.</p>
                  <div class="flex justify-end gap-1.5">
                    <ButtonUI variant="outline" size="xs" @click="freshApiToken = null">Add another</ButtonUI>
                    <ButtonUI size="xs" @click="closeAddToken">Done</ButtonUI>
                  </div>
                </template>
              </div>
              <p v-else-if="apiTokenError" class="text-[9px] text-danger">{{ apiTokenError }}</p>

              <!-- existing tokens, laid out like the members list -->
              <div v-if="tokens.length" class="flex flex-col rounded-xl border border-input">
                <div
                  v-for="t in tokens"
                  :key="t.id"
                  class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
                >
                  <span class="size-1.5 shrink-0 rounded-full" :class="t.lastUsedAt ? 'bg-success' : 'bg-muted-foreground/40'" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium">{{ t.name }}</p>
                    <p class="truncate text-[9px] text-muted-foreground">
                      Created {{ timeAgo(t.createdAt) }} ·
                      {{ t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used' }}
                    </p>
                  </div>
                  <MenuUI>
                    <template #default="{ close }">
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
                        @click="(onRevokeToken(t.id, t.name), close())"
                      >
                        <Trash2 class="size-3.5" /> Revoke
                      </button>
                    </template>
                  </MenuUI>
                </div>
              </div>
              <EmptyListUI v-else>No tokens yet — add one to connect an MCP client.</EmptyListUI>
            </SettingsGroup>

            <SettingsGroup
              v-if="isAdmin"
              title="Agent permissions"
              description="What an agent holding a token may do. Everything is off until you allow it here."
            >
              <div class="flex flex-col rounded-xl border border-input">
                <div
                  v-for="sw in AGENT_SWITCHES"
                  :key="sw.id"
                  class="flex items-center gap-3 border-b border-input px-3 py-2 last:border-b-0"
                >
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium">{{ sw.label }}</p>
                    <p class="text-[9px] text-muted-foreground">{{ sw.hint }}</p>
                  </div>
                  <ToggleUI
                    :model-value="agentPolicy[sw.id]"
                    :aria-label="sw.label"
                    :disabled="agentPolicyBusy === sw.id"
                    @update:model-value="setAgentFlag(sw.id, $event)"
                  />
                </div>
              </div>
              <p v-if="agentPolicyError" class="text-[9px] text-danger">{{ agentPolicyError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-9" id="users">
            <UsersSettings />
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-9" id="backup">
            <SettingsGroup
              title="Snapshots"
              description="Restore points of every page, draft, setting and media file."
            >
              <template #action>
                <ButtonUI size="xs" :icon="Plus" :disabled="snapshotBusy" @click="takeSnapshot">
                  {{ snapshotBusy ? 'Saving…' : 'Snapshot' }}
                </ButtonUI>
              </template>
              <div v-if="snapshots.length" class="flex flex-col rounded-xl border border-input">
                <div
                  v-for="snap in snapshots"
                  :key="snap.id"
                  class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
                >
                  <span class="size-1.5 shrink-0 rounded-full bg-success" />
                  <div class="min-w-0 flex-1">
                    <input
                      v-if="renamingSnapshot === snap.id"
                      v-model="snapshotDraftName"
                      :ref="(el) => (el as HTMLInputElement | null)?.focus()"
                      type="text"
                      spellcheck="false"
                      :placeholder="new Date(snap.createdAt).toLocaleString()"
                      class="h-5 w-full rounded-md bg-input px-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      @keydown.enter.prevent="commitRenameSnapshot(snap)"
                      @keydown.escape.stop.prevent="renamingSnapshot = null"
                      @blur="commitRenameSnapshot(snap)"
                    />
                    <p
                      v-else
                      class="cursor-text truncate text-xs font-medium"
                      @dblclick="startRenameSnapshot(snap)"
                    >
                      {{ snap.name || new Date(snap.createdAt).toLocaleString() }}
                    </p>
                    <p class="truncate text-[10px] text-muted-foreground">
                      <template v-if="snap.name">{{ new Date(snap.createdAt).toLocaleString() }} · </template>
                      {{ timeAgo(snap.createdAt) }} · {{ formatBytes(snap.bytes) }}
                    </p>
                  </div>
                  <ButtonUI variant="outline" size="xs" @click="restoreSnapshot(snap)">Restore</ButtonUI>
                  <MenuUI>
                    <template #default="{ close }">
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
                        @click="(startRenameSnapshot(snap), close())"
                      >
                        <Pencil class="size-3.5" /> Rename
                      </button>
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
                        @click="(downloadSnapshot(snap), close())"
                      >
                        <Archive class="size-3.5" /> Download
                      </button>
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
                        @click="(deleteSnapshot(snap), close())"
                      >
                        <Trash2 class="size-3.5" /> Delete
                      </button>
                    </template>
                  </MenuUI>
                </div>
              </div>
              <EmptyListUI v-else>No snapshots yet — take one before a big change.</EmptyListUI>
              <p v-if="snapshotError" class="text-[10px] text-danger">{{ snapshotError }}</p>
            </SettingsGroup>

            <SettingsGroup
              title="Import"
              description="Restores a downloaded package, replacing everything for every user."
            >
              <template #action>
                <input
                  ref="importInput"
                  type="file"
                  accept=".zip,application/zip"
                  class="hidden"
                  @change="onImportFile"
                />
                <ButtonUI size="xs" :icon="Archive" :disabled="importing" @click="importInput?.click()">
                  {{ importing ? 'Importing…' : 'Import' }}
                </ButtonUI>
              </template>
              <p v-if="importError" class="text-[10px] text-danger">{{ importError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="account">
            <SettingsGroup title="Profile" description="Your name and sign-in email.">
              <RowUI label="Name">
                <InputUI v-model="accName" placeholder="Your name" />
              </RowUI>
              <RowUI label="Email">
                <InputUI v-model="accEmail" type="email" placeholder="you@example.com" />
              </RowUI>
            </SettingsGroup>
            <SettingsGroup title="Change password" description="Leave blank to keep your current password.">
              <RowUI label="New">
                <InputUI v-model="accPassword" type="password" placeholder="Leave blank to keep" />
              </RowUI>
              <RowUI v-if="accPassword" label="Current">
                <InputUI v-model="accCurrentPassword" type="password" placeholder="Current password" />
              </RowUI>
            </SettingsGroup>
            <div class="flex items-center gap-2">
              <ButtonUI variant="default" size="sm" :disabled="accBusy" @click="saveAccount">
                {{ accBusy ? 'Saving…' : 'Save changes' }}
              </ButtonUI>
              <span v-if="accSaved" class="flex items-center gap-1 text-[9px] text-success">
                <Check class="size-3.5" /> Saved
              </span>
              <span v-if="accError" class="text-[9px] text-danger">{{ accError }}</span>
            </div>
          </TabPanelUI>
        </div>
      </div>
      </TabsUI>
    </div>
  </ModalHost>
</template>
