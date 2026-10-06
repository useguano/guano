<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import { timeAgo } from '@/lib/time'

/** what the drawer is showing settings for */
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

const STATUS_OPTIONS = [
  { label: 'Published', value: 'published' },
  { label: 'Draft', value: 'draft' },
]

// --- resolve the target (narrow the union through a local const) ---
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

/** the thing that carries seo / status / timestamps, whichever kind */
const item = computed(() => page.value ?? entry.value)
const kindLabel = computed(() => (props.target.kind === 'page' ? 'Page' : 'Item'))
const headerLabel = computed(() =>
  props.target.kind === 'entry' ? 'Edit item' : `${kindLabel.value} settings`,
)

// the target can vanish under us — deleted on the canvas, by another client
// through live sync, or with its whole collection. The root is `v-if="item"`
// with no v-else, so without this the panel would render blank with Escape as
// the only way out. (onDuplicate/onDelete also emit back; a double emit just
// clears settingsTarget twice, which is harmless.)
watch(item, (it) => {
  if (!it) emit('back')
})
const isHome = computed(() => props.target.kind === 'page' && page.value?.id === homePage.value.id)

// --- title / slug: committed on change (page edits rebuild the @setup block) ---
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
function commitSlug() {
  const slug = slugField.value.trim()
  if (page.value) updatePageMeta(page.value.id, { slug })
  else if (collection.value && entry.value)
    updateEntryMeta(collection.value, entry.value.id, { slug })
}

const status = computed({
  get: () => item.value?.status ?? 'published',
  set: (v: string) => {
    if (page.value) updatePageMeta(page.value.id, { status: v })
    else if (collection.value && entry.value)
      updateEntryMeta(collection.value, entry.value.id, { status: v })
  },
})

// --- SEO: mutated directly; empty values prune so untouched items stay
// byte-identical. The edit-tracking watcher stamps updatedAt. ---
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

// --- per-page custom code: page metadata, so it lives here rather than in the
// right rail. Pages only (entries have no customCode) and build roles only —
// raw <script> on a published page is the same privilege the server gates a
// contributor's write on, so don't offer an input that would 403. Empty prunes
// the field, like the SEO overrides above. ---
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

// --- actions ---
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
        </DrawerField>

        <!-- two mutually exclusive values never needed a popover; segments also
             keep the row from reflowing as a dropdown opens and closes. The
             active one is accent-tinted, the same "this is selected" the
             drawer's own page/entry rows use — `bg-background` would read as
             raised in the dark theme and inset in the light one. -->
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

      <!-- history is reference, not a field: it sits with the actions rather
           than taking a section and two label gutters of its own -->
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
