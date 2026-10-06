<script setup lang="ts">
/**
 * One collection-entry field, rendered as the right control for its type.
 * Used by the Pages drawer's entry editor (PageSettingsEditor's Content
 * section). All reads/writes go through useEntryField — see its header for
 * the invariants and for the second, not-yet-migrated copy in DataEditor.
 *
 * `entry` is a plain prop object ON PURPOSE: the parent re-derives it from
 * {collectionId, entryId} every render, so it cannot detach when undo, a
 * branch switch or a merge replaces the whole `project` ref. Do not "optimize"
 * it into a stored ref.
 */
import { computed } from 'vue'
import { ArrowDown, ArrowUp } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import DrawerField from './DrawerField.vue'
import RichTextInput from '@/components/editor/content/RichTextInput.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import { useEntryField } from '@/composables/useEntryField'
import { fieldValueError } from '@/lib/collectionFields'
import { useCollections } from '@/composables/useCollections'
import { useLocale } from '@/composables/useLocale'
import { useMedia } from '@/composables/useMedia'
import type { CollectionEntry, CollectionField } from '@/types/editor'

const props = defineProps<{ entry: CollectionEntry; field: CollectionField }>()

const {
  textModel, fallbackText, lockedInLocale,
  readRef, setRef, toggleRef, setListAt, writeList, moveInList,
  refIds, mediaUrls,
} = useEntryField()
const { collectionById } = useCollections()
const { isDefault, defaultLocale } = useLocale()
const { assetForSrc } = useMedia()

const locked = computed(() => lockedInLocale(props.field))
const text = textModel(() => props.entry, () => props.field)
/** the default-locale value, shown while translating so the field never
 *  reads as empty when it is really falling back */
const fallback = computed(() =>
  isDefault.value || locked.value ? '' : fallbackText(props.entry, props.field),
)

// --- date: never an unconditional type="date" -------------------------------
// values are unconstrained strings (nothing parses them; fields.js sorts them
// as text), and a native date input given "March 2024" renders BLANK — the
// value would be invisible in the only UI that edits it. Empty and already-ISO
// values get the picker; a legacy free-form value stays a text box and
// upgrades itself the moment it becomes ISO.
const isIso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const dateType = computed(() => (!text.value || isIso(text.value) ? 'date' : 'text'))

// --- number / yes-no / choice ----------------------------------------------
// All three store a STRING, like every other scalar, so they ride the same
// locale-aware model — and all three are non-translatable by type, so that
// model only ever writes the base value.
const numberError = computed(() => fieldValueError(props.field, text.value))
const boolModel = computed({
  get: () => text.value === 'true',
  set: (on: boolean) => (text.value = on ? 'true' : 'false'),
})
/** the stored VALUE is the option: a page renders its own label per option, so
 *  the key stays stable while the words translate with the markup */
const choiceOptions = computed(() => [
  { label: 'None', value: '' },
  ...(props.field.options ?? []).map((o) => ({ label: o, value: o })),
])

// --- references -------------------------------------------------------------
const refTarget = computed(() =>
  props.field.refCollectionId ? collectionById(props.field.refCollectionId) : null,
)
const refOptions = computed(() => [
  { label: 'None', value: '' },
  ...(refTarget.value?.entries.map((e) => ({ label: e.name, value: e.id })) ?? []),
])
const selectedRef = computed({
  get: () => readRef(props.entry, props.field),
  set: (id: string) => setRef(props.entry, props.field, id),
})
const multiIds = computed(() => refIds(props.entry, props.field.name))

// --- gallery ----------------------------------------------------------------
const gallery = computed(() => mediaUrls(props.entry, props.field.name))
function addImage(url: string) {
  if (url) writeList(props.entry, props.field, [...gallery.value, url])
}

// an image src that is legal but not a library asset (a data: URL, an external
// https: one) renders as "No file selected" in the picker — surface the raw
// value so the field never reads as empty while holding data
const rawSrc = computed(() => (text.value && !assetForSrc(text.value) ? text.value : ''))
</script>

<template>
  <DrawerField :label="field.name">
    <template v-if="locked" #end>
      <BadgeUI v-tooltip="`Edit it in ${defaultLocale}.`">Not translatable</BadgeUI>
    </template>

    <!-- text: rich by the same sanitizer the exporter and MCP use -->
    <RichTextInput
      v-if="field.type === 'text'"
      v-model="text"
      compact
      :disabled="locked"
      :placeholder="fallback"
    />

    <!-- image: the picker only ever yields /media/<id>, so SAFE_SRC holds -->
    <template v-else-if="field.type === 'image'">
      <!-- the picker has no disabled prop; a locked field is inert + dimmed -->
      <div :class="locked && 'pointer-events-none opacity-50'">
        <MediaPickerControl v-model="text" kind="image" />
      </div>
      <p v-if="rawSrc" class="truncate text-[10px] text-muted-foreground" :title="rawSrc">
        {{ rawSrc }}
      </p>
    </template>

    <template v-else-if="field.type === 'number'">
      <InputUI v-model="text" type="number" :disabled="locked" placeholder="0" />
      <p v-if="numberError" class="text-[10px] text-danger">{{ numberError }}</p>
    </template>

    <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 text-xs">
      <input v-model="boolModel" type="checkbox" :disabled="locked" class="size-3.5" />
      {{ boolModel ? 'Yes' : 'No' }}
    </label>

    <template v-else-if="field.type === 'select'">
      <SelectUI
        v-if="field.options?.length"
        v-model="text"
        :options="choiceOptions"
        placeholder="None"
      />
      <p v-else class="text-[10px] text-muted-foreground">
        No options yet — add them to the field in the collection's settings.
      </p>
    </template>

    <template v-else-if="field.type === 'date'">
      <InputUI v-model="text" :type="dateType" placeholder="YYYY-MM-DD" :disabled="locked" />
      <p v-if="dateType === 'text'" class="text-[10px] text-muted-foreground">
        Use YYYY-MM-DD so lists sort correctly.
      </p>
    </template>

    <!-- references store ids and are never locale-overridden -->
    <template v-else-if="field.type === 'reference'">
      <SelectUI v-if="refTarget" v-model="selectedRef" :options="refOptions" placeholder="None" />
      <p v-else class="text-[10px] text-muted-foreground">
        Points at a collection that no longer exists.
      </p>
    </template>

    <template v-else-if="field.type === 'multi-reference'">
      <div v-if="refTarget" class="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        <label
          v-for="target in refTarget.entries"
          :key="target.id"
          class="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent/15"
        >
          <input
            type="checkbox"
            :checked="multiIds.includes(target.id)"
            class="accent-current"
            @change="toggleRef(entry, field, target.id)"
          />
          <span class="truncate">{{ target.name }}</span>
        </label>
        <p v-if="!refTarget.entries.length" class="text-[10px] text-muted-foreground">
          No entries in the referenced collection yet.
        </p>
      </div>
      <p v-else class="text-[10px] text-muted-foreground">
        Points at a collection that no longer exists.
      </p>
    </template>

    <!-- gallery: order is what a :collection-list renders, so it's editable.
         Clearing a slot removes it — the list never holds holes. -->
    <template v-else-if="field.type === 'multi-image'">
      <div v-for="(url, i) in gallery" :key="`${url}-${i}`" class="flex items-start gap-1">
        <MediaPickerControl
          :model-value="url" kind="image" class="min-w-0 flex-1"
          @update:model-value="setListAt(entry, field, i, $event)"
        />
        <div class="flex shrink-0 flex-col">
          <ButtonUI
            variant="icon" size="xs" :icon="ArrowUp" tooltip="Move up"
            class="w-6 text-muted-foreground" :disabled="i === 0"
            @click="moveInList(entry, field, i, -1)"
          />
          <ButtonUI
            variant="icon" size="xs" :icon="ArrowDown" tooltip="Move down"
            class="w-6 text-muted-foreground" :disabled="i === gallery.length - 1"
            @click="moveInList(entry, field, i, 1)"
          />
        </div>
      </div>
      <MediaPickerControl :key="gallery.length" model-value="" kind="image" @update:model-value="addImage" />
    </template>
  </DrawerField>
</template>
