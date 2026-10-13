<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ChevronLeft, Copy, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import DrawerField from './DrawerField.vue'
import DrawerSection from './DrawerSection.vue'
import EntryFieldControl from './EntryFieldControl.vue'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useModal } from '@/composables/useModal'
import { useLocale } from '@/composables/useLocale'
import { useAuth } from '@/composables/useAuth'
import { useSettings } from '@/composables/useSettings'
import { normalizeRedirectPath } from '@/lib/settings'
import { entryRoutePath } from '@/lib/shared/slug.js'
import { timeAgo } from '@/lib/time'

export type SettingsTarget =
  | { kind: 'page'; pageId: string }
  | { kind: 'entry'; collectionId: string; entryId: string }

const props = defineProps<{ target: SettingsTarget }>()
const emit = defineEmits<{ back: []; close: [] }>()

const { pages, updatePageMeta, duplicatePage, removePage, homePage } = usePage()
const { collections, updateEntryMeta, duplicateEntry, removeEntry } = useCollections()
const { confirm } = useModal()
const { activeLocale, defaultLocale, isDefault } = useLocale()
const { canBuild } = useAuth()
const { redirectFrom, setRedirect, removeRedirect } = useSettings()

const STATUS_OPTIONS = [
  { label: 'Published', value: 'published' },
  { label: 'Draft', value: 'draft' },
]

const page = computed(() => {
  const t = props.target
  return t.kind === 'page' ? (pages.value.find((p) => p.id === t.pageId) ?? null) : null
})
const collection = computed(() => {
  const t = props.target
  return t.kind === 'entry' ? (collections.value.find((c) => c.id === t.collectionId) ?? null) : null
})
const entry = computed(() => {
  const t = props.target
  return t.kind === 'entry' && collection.value
    ? (collection.value.entries.find((e) => e.id === t.entryId) ?? null)
    : null
})

const item = computed(() => page.value ?? entry.value)
const kindLabel = computed(() => (props.target.kind === 'page' ? 'Page' : 'Item'))
const headerLabel = computed(() =>
  props.target.kind === 'entry' ? 'Edit item' : `${kindLabel.value} settings`,
)

watch(item, (it) => {
  if (!it) emit('back')
})
const isHome = computed(() => props.target.kind === 'page' && page.value?.id === homePage.value.id)

const titleField = ref('')
const slugField = ref('')
watch(
  item,
  (it) => {
    if (!it) return
    titleField.value = it.name
    slugField.value = page.value ? page.value.path : (entry.value?.slug ?? '')
  },
  { immediate: true },
)

function commitTitle() {
  const name = titleField.value.trim()
  if (!name) return
  if (page.value) updatePageMeta(page.value.id, { name })
  else if (collection.value && entry.value)
    updateEntryMeta(collection.value, entry.value.id, { name })
}
/**
 * Where this item answered BEFORE the first slug change of this session, per
 * id — the path other people's links point at, and the only one worth a 301.
 * Module-level because the drawer unmounts every time you navigate away, and
 * the offer has to survive that; keyed by id, so two renames do not mix.
 * The FIRST value wins: /a → /b → /c should offer /a, not /b.
 *
 * REACTIVE, and that is not decoration: a plain Map read inside `redirectOffer`
 * is not a dependency, so the computed stayed on the `null` it returned at
 * mount — it had early-returned before ever touching `page.path`, so nothing
 * it tracked changed when the slug did, and the offer never appeared. A
 * `reactive` Map tracks `get`/`has` per key (the same reason useElement's
 * selection marks are one).
 */
const pathBefore = reactive(new Map<string, string>())
const offerDismissed = reactive(new Set<string>())

function routeOf(target: SettingsTarget, path: string): string {
  if (target.kind === 'page') return normalizeRedirectPath(path || '/')
  const col = collections.value.find((c) => c.id === target.collectionId)
  const entry = col?.entries.find((e) => e.id === target.entryId)
  if (!col || !entry) return ''
  return normalizeRedirectPath(entryRoutePath(col, { ...entry, slug: path }) ?? '')
}

function commitSlug() {
  const slug = slugField.value.trim()
  const before = page.value ? page.value.path : (entry.value?.slug ?? '')
  const id = page.value?.id ?? entry.value?.id
  if (page.value) updatePageMeta(page.value.id, { slug })
  else if (collection.value && entry.value)
    updateEntryMeta(collection.value, entry.value.id, { slug })
  // remember where it used to live, so the redirect can be offered. Only for
  // a real move: typing in the field and tabbing out unchanged is not one.
  if (id && slug !== before && before) {
    if (!pathBefore.has(id)) pathBefore.set(id, before)
    offerDismissed.delete(id)
  }
}

/** the 301 worth adding after a rename: the old route, and where it went */
const redirectOffer = computed(() => {
  const id = page.value?.id ?? entry.value?.id
  if (!id || !canBuild.value || isHome.value) return null
  if (offerDismissed.has(id)) return null
  const was = pathBefore.get(id)
  if (!was) return null
  const from = routeOf(props.target, was)
  const to = routeOf(props.target, page.value ? page.value.path : (entry.value?.slug ?? ''))
  // renamed back to where it started, or the rule is already there
  if (!from || !to || from === to) return null
  const have = redirectFrom(from)
  if (have && normalizeRedirectPath(have.to) === to) return null
  return { from, to, replacing: have ?? null }
})

function acceptRedirect() {
  const offer = redirectOffer.value
  const id = page.value?.id ?? entry.value?.id
  if (!offer || !id) return
  setRedirect(offer.from, offer.to)
  pathBefore.delete(id)
}

/** keeping a shadowed rule is a real choice (the page may move again) */
function keepClashingRedirect() {
  const id = redirectClash.value?.id
  if (id) clashKept.add(id)
}

function dismissRedirect() {
  const id = page.value?.id ?? entry.value?.id
  if (id) offerDismissed.add(id)
}

/**
 * This item's own route is the SOURCE of a redirect — the "someone creates a
 * page with the slug of something that is already redirected" case. The page
 * wins either way (the export drops a shadowed rule), so the question is only
 * whether to keep carrying a rule that no longer does anything.
 *
 * Shown ALONGSIDE the offer rather than instead of it, because renaming back
 * onto an old path makes both true and they are different questions: the path
 * you just left needs a redirect, and the one you came back to is still
 * redirecting away (which would be a loop if a page did not always win). The
 * one case that is NOT two questions is the rule the offer would replace —
 * the offer says "instead of" for that, so it is suppressed here.
 */
const clashKept = reactive(new Set<string>())
const redirectClash = computed(() => {
  if (!canBuild.value) return null
  const mine = routeOf(props.target, page.value ? page.value.path : (entry.value?.slug ?? ''))
  if (!mine) return null
  const offer = redirectOffer.value
  // not the rule we are about to create for this very rename
  if (offer && normalizeRedirectPath(offer.from) === mine) return null
  const hit = redirectFrom(mine)
  return hit && !clashKept.has(hit.id) ? hit : null
})

const status = computed({
  get: () => item.value?.status ?? 'published',
  set: (v: string) => {
    if (page.value) updatePageMeta(page.value.id, { status: v })
    else if (collection.value && entry.value)
      updateEntryMeta(collection.value, entry.value.id, { status: v })
  },
})

function seoField(key: 'title' | 'description') {
  return computed({
    get: () => item.value?.seo?.[key] ?? '',
    set: (v: string) => {
      const it = item.value
      if (!it) return
      if (v) (it.seo ??= {})[key] = v
      else if (it.seo) {
        delete it.seo[key]
        if (!Object.keys(it.seo).length) delete it.seo
      }
    },
  })
}
const seoTitle = seoField('title')
const seoDescription = seoField('description')

function customCodeField(key: 'head' | 'body') {
  return computed<string>({
    get: () => page.value?.customCode?.[key] ?? '',
    set: (value: string) => {
      const p = page.value
      if (!p) return
      if (value.trim()) (p.customCode ??= {})[key] = value
      else if (p.customCode) {
        delete p.customCode[key]
        if (!Object.keys(p.customCode).length) delete p.customCode
      }
    },
  })
}
const headCode = customCodeField('head')
const bodyCode = customCodeField('body')

function onDuplicate() {
  if (page.value) duplicatePage(page.value.id)
  else if (collection.value && entry.value) duplicateEntry(collection.value, entry.value.id)
  emit('back')
}

async function onDelete() {
  const name = item.value?.name ?? 'this'
  const ok = await confirm({
    title: `Delete ${kindLabel.value.toLowerCase()}`,
    message: `Delete “${name}”? This can’t be undone.`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  if (page.value) removePage(page.value.id)
  else if (collection.value && entry.value) removeEntry(collection.value, entry.value.id)
  emit('back')
}

function whenBy(at?: number, by?: string): string {
  if (!at) return '—'
  return by ? `${timeAgo(at)} · ${by}` : timeAgo(at)
}
const hasHistory = computed(() => Boolean(item.value?.createdAt || item.value?.updatedAt))
</script>

<template>
  <div v-if="item" class="flex min-h-full flex-col">
    <div class="flex h-11 shrink-0 items-center gap-1 px-1.5">
      <ButtonUI
        variant="icon"
        size="sm"
        :icon="ChevronLeft"
        tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="emit('back')"
      />
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ headerLabel }}</span>
    </div>

    <div class="flex flex-1 flex-col gap-5 px-2.5 pt-1 pb-3">
      <DrawerSection v-if="entry && collection" title="Content">
        <p v-if="!isDefault" class="text-[10px] text-muted-foreground">
          Translating {{ activeLocale }} — empty fields fall back to {{ defaultLocale }}.
        </p>
        <EntryFieldControl
          v-for="field in collection.fields"
          :key="field.id"
          :entry="entry"
          :field="field"
        />
        <p v-if="!collection.fields.length" class="text-[10px] text-muted-foreground">
          No fields yet.<template v-if="collection.templatePageId">
            Add them from the collection template.</template>
        </p>
      </DrawerSection>

      <DrawerSection title="General">
        <DrawerField label="Title">
          <InputUI
            v-model="titleField"
            placeholder="Untitled"
            @blur="commitTitle"
            @keydown.enter="commitTitle"
          />
        </DrawerField>

        <DrawerField
          label="Slug"
          :hint="isHome ? 'The home page path is fixed.' : undefined"
        >
          <InputUI
            v-model="slugField"
            class="font-mono"
            :disabled="isHome"
            :placeholder="page ? '/path' : 'slug'"
            @blur="commitSlug"
            @keydown.enter="commitSlug"
          />
          <div
            v-if="redirectOffer"
            class="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-input bg-input/40 p-2"
          >
            <p class="text-[10px] leading-snug text-muted-foreground">
              Links to <span class="font-mono text-foreground">{{ redirectOffer.from }}</span> will
              break.
              <template v-if="redirectOffer.replacing">
                Point it at
                <span class="font-mono text-foreground">{{ redirectOffer.to }}</span> instead of
                <span class="font-mono text-foreground">{{ redirectOffer.replacing.to }}</span>?
              </template>
              <template v-else>
                Redirect it to
                <span class="font-mono text-foreground">{{ redirectOffer.to }}</span>?
              </template>
            </p>
            <div class="flex justify-end gap-1.5">
              <ButtonUI variant="outline" size="xs" @click="dismissRedirect">No thanks</ButtonUI>
              <ButtonUI size="xs" @click="acceptRedirect">
                {{ redirectOffer.replacing ? 'Replace redirect' : 'Add 301 redirect' }}
              </ButtonUI>
            </div>
          </div>
          <div
            v-if="redirectClash"
            class="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-input bg-input/40 p-2"
          >
            <p class="text-[10px] leading-snug text-muted-foreground">
              This path already redirects to
              <span class="font-mono text-foreground">{{ redirectClash.to }}</span
              >. This page wins, so the redirect does nothing — remove it?
            </p>
            <div class="flex justify-end gap-1.5">
              <ButtonUI variant="outline" size="xs" @click="keepClashingRedirect">Keep it</ButtonUI>
              <ButtonUI size="xs" @click="removeRedirect(redirectClash.id)">
                Remove redirect
              </ButtonUI>
            </div>
          </div>
        </DrawerField>

        <DrawerField label="Status">
          <div class="flex h-7 w-full items-center gap-0.5 rounded-lg bg-input p-0.5">
            <button
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              type="button"
              class="flex h-6 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
              :class="
                status === option.value
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="status = option.value"
            >
              <span
                v-if="option.value === 'draft'"
                class="size-1.5 shrink-0 rounded-full bg-pending"
              />
              {{ option.label }}
            </button>
          </div>
        </DrawerField>
      </DrawerSection>

      <DrawerSection title="SEO">
        <DrawerField label="Title">
          <InputUI v-model="seoTitle" :placeholder="`Defaults to the ${kindLabel.toLowerCase()} title`" />
        </DrawerField>
        <DrawerField label="Description">
          <TextareaUI
            v-model="seoDescription"
            :rows="3"
            placeholder="Shown in search results"
          />
        </DrawerField>
      </DrawerSection>

      <DrawerSection v-if="page && canBuild" title="Custom code">
        <DrawerField label="Head">
          <TextareaUI
            v-model="headCode"
            :rows="4"
            class="font-mono"
            placeholder="Runs at the top of the page"
          />
        </DrawerField>
        <DrawerField
          label="Body"
          hint="Wrapped in a script tag on this page's export only — it does not run in the editor."
        >
          <TextareaUI
            v-model="bodyCode"
            :rows="4"
            class="font-mono"
            placeholder="Runs before the closing body tag"
          />
        </DrawerField>
      </DrawerSection>

      <div class="mt-auto flex flex-col gap-2 pt-2">
        <div v-if="hasHistory" class="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span v-if="item.createdAt" class="truncate">
            Created {{ whenBy(item.createdAt, item.createdBy) }}
          </span>
          <span v-if="item.updatedAt" class="truncate">
            Updated {{ whenBy(item.updatedAt, item.updatedBy) }}
          </span>
        </div>
        <div class="flex gap-1">
          <ButtonUI
            variant="ghost"
            size="sm"
            :icon="Copy"
            class="flex-1 justify-center text-muted-foreground"
            @click="onDuplicate"
          >
            Duplicate
          </ButtonUI>
          <ButtonUI
            variant="ghost"
            size="sm"
            :icon="Trash2"
            class="flex-1 justify-center !text-danger"
            :disabled="isHome"
            @click="onDelete"
          >
            Delete
          </ButtonUI>
        </div>
      </div>
    </div>
  </div>
</template>
