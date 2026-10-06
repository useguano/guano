<script setup lang="ts">
/**
 * A collection's settings, in the Pages drawer: its fields and where its
 * entries live on the site.
 *
 * Fields could previously be edited in one place only — the Data panel, with
 * the template page's body selected — which a data-only collection (no
 * template page) could not reach at all.
 *
 * Holds an id, never the object: undo, a draft switch and a merge all replace
 * the whole `project` ref, and a held collection would silently detach.
 */
import { computed, ref, watch } from 'vue'
import { ChevronLeft, Copy, Plus, Trash2, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import DrawerField from './DrawerField.vue'
import DrawerSection from './DrawerSection.vue'
import { useCollections } from '@/composables/useCollections'
import { useModal } from '@/composables/useModal'
import { FIELD_TYPES, fieldNameError, isRefType, setFieldType } from '@/lib/collectionFields'
import { collectionRouteBase, hasDetailRoutes } from '@/lib/shared/slug.js'
import type { CollectionField } from '@/types/editor'

const props = defineProps<{ collectionId: string }>()
const emit = defineEmits<{ back: [] }>()

const { collections, addField, removeField, duplicateCollection, removeCollection } =
  useCollections()
const { confirm } = useModal()

const collection = computed(
  () => collections.value.find((c) => c.id === props.collectionId) ?? null,
)

// the collection can vanish under us (deleted, or the project replaced by
// undo/a draft switch) — the root is `v-if`, so without this the pane would
// render blank with no way back
watch(collection, (c) => {
  if (!c) emit('back')
})

const collectionOptions = computed(() =>
  collections.value.map((c) => ({ label: c.name, value: c.id })),
)

const onType = (field: CollectionField, type: string | undefined) => {
  if (type) setFieldType(field, type as CollectionField['type'], collections.value)
}

/** why the name in the box cannot be used, or null — a name an ENTRY already
 *  uses for itself (`slug`, `status`, …) renders from `values` and then
 *  disagrees with the entry's own value wherever a route is computed. Shown
 *  rather than blocked: the box is being typed in, and a half-typed name is
 *  not an error yet. */
const nameIssue = (field: CollectionField) => fieldNameError(field.name)

/** the options list, deduped and trimmed. Renaming an option does NOT rewrite
 *  the entries holding the old value — they simply read as unset in the picker
 *  until someone picks again, which is visible, where a silent rewrite would
 *  not be. */
function setOptions(field: CollectionField, text: string) {
  const next = [...new Set(text.split('\n').map((o) => o.trim()).filter(Boolean))]
  if (next.length) field.options = next
  else delete field.options
}

// --- URL prefix: committed on blur/Enter. Blank restores the default (the
// collection's own name); '/' puts entries at the site root. ---
const routed = computed(() => !!collection.value && hasDetailRoutes(collection.value))
const prefixField = ref('')
watch(
  collection,
  (c) => {
    if (!c) return
    prefixField.value = c.routeBase === '' ? '/' : (c.routeBase ?? '')
  },
  { immediate: true },
)

function commitPrefix() {
  const c = collection.value
  if (!c) return
  const raw = prefixField.value.trim()
  if (!raw) delete c.routeBase
  else if (raw === '/') c.routeBase = ''
  else c.routeBase = raw.replace(/^\/+|\/+$/g, '')
  prefixField.value = c.routeBase === '' ? '/' : (c.routeBase ?? '')
}

const examplePath = computed(() => {
  const c = collection.value
  if (!c) return ''
  const base = collectionRouteBase(c)
  return base ? `/${base}/my-entry` : '/my-entry'
})

// --- actions ---
function onDuplicate() {
  if (collection.value) duplicateCollection(collection.value)
  emit('back')
}

async function onDelete() {
  const c = collection.value
  if (!c) return
  const n = c.entries.length
  const ok = await confirm({
    title: 'Delete collection',
    message: `Delete the collection “${c.name}”? ${
      c.templatePageId ? 'Its template page and all' : 'All'
    } ${n} ${n === 1 ? 'entry' : 'entries'} will be permanently deleted.`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  removeCollection(c)
  emit('back')
}
</script>

<template>
  <div v-if="collection" class="flex min-h-full flex-col">
    <!-- h-11 matches the list view's search row, so the swap moves nothing -->
    <div class="flex h-11 shrink-0 items-center gap-1 px-1.5">
      <ButtonUI
        variant="icon"
        size="sm"
        :icon="ChevronLeft"
        tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="emit('back')"
      />
      <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ collection.name }}</span>
    </div>

    <div class="flex flex-1 flex-col gap-5 px-2.5 pt-1 pb-3">
      <DrawerSection title="Fields">
        <p v-if="!collection.fields.length" class="text-[10px] text-muted-foreground">
          No fields yet.
        </p>
        <div
          v-for="field in collection.fields"
          :key="field.id"
          :data-field="field.name"
          class="flex flex-col gap-1.5 rounded-lg bg-accent/10 p-2"
        >
          <div class="flex items-center gap-1">
            <InputUI v-model="field.name" class="font-mono" placeholder="name" />
            <ButtonUI
              variant="icon"
              size="sm"
              :icon="X"
              tooltip="Remove field"
              class="w-6 shrink-0 text-muted-foreground"
              @click="removeField(collection, field.id)"
            />
          </div>
          <p v-if="nameIssue(field)" class="text-[10px] text-danger">{{ nameIssue(field) }}</p>
          <SelectUI
            :model-value="field.type"
            :options="FIELD_TYPES"
            @update:model-value="(v) => onType(field, v)"
          />
          <DrawerField v-if="isRefType(field.type)" label="Points to">
            <SelectUI v-model="field.refCollectionId" :options="collectionOptions" />
          </DrawerField>
          <!-- a choice's options are the VALUES entries store and that
               `data-[…]:` variants and list filters match on, so they are
               edited here once rather than typed per entry -->
          <DrawerField
            v-if="field.type === 'select'"
            label="Options"
            hint="One per line. The stored value — a page renders its own label per option."
          >
            <textarea
              :value="(field.options ?? []).join('\n')"
              rows="3"
              spellcheck="false"
              class="w-full rounded-md border border-border bg-input px-2 py-1 text-xs"
              @change="(e) => setOptions(field, (e.target as HTMLTextAreaElement).value)"
            />
          </DrawerField>
          <div v-if="field.type === 'text'" class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-medium text-muted-foreground">Translatable</span>
            <ToggleUI
              :model-value="field.localize !== false"
              @update:model-value="(v) => (field.localize = v ? undefined : false)"
            />
          </div>
        </div>
        <ButtonUI
          variant="outline"
          size="sm"
          :icon="Plus"
          class="w-full"
          @click="addField(collection)"
        >
          Add field
        </ButtonUI>
      </DrawerSection>

      <DrawerSection title="URL">
        <DrawerField
          v-if="routed"
          label="Prefix"
          :hint="`Entries publish at ${examplePath}. Blank uses the collection name; / puts them at the site root.`"
        >
          <InputUI
            v-model="prefixField"
            class="font-mono"
            :placeholder="collection.name"
            @blur="commitPrefix"
            @keydown.enter="commitPrefix"
          />
        </DrawerField>
        <p v-else class="text-[10px] text-muted-foreground">
          A data-only collection: its entries render inside other pages and have no page of
          their own.
        </p>
      </DrawerSection>

      <div class="mt-auto flex gap-1 pt-2">
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
          @click="onDelete"
        >
          Delete
        </ButtonUI>
      </div>
    </div>
  </div>
</template>
