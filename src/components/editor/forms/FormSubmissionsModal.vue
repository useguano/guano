<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Download, Inbox, Trash2, TriangleAlert } from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import EmptyListUI from '@/components/ui/EmptyListUI.vue'
import { useFormSubmissions, type Submission } from '@/composables/useFormSubmissions'
import { useModal } from '@/composables/useModal'
import { timeAgo } from '@/lib/time'
import { formatBytes } from '@/lib/media'
import { downloadBlob, filenameFrom } from '@/lib/download'

/**
 * Who submitted what. The form list on the left, one form's rows on the right.
 *
 * Every value here was typed by a stranger on the internet, so it renders as
 * TEXT only — `{{ }}`, never `v-html`, anywhere in this file. The CSV download
 * guards the other half of that problem (a cell starting with `=` is a formula
 * a spreadsheet executes; see server/public/csv.mjs).
 */
const props = defineProps<{ formId?: string }>()
const emit = defineEmits<{ close: [] }>()

const { forms, loadForms, loadSubmissions, deleteSubmission, deleteAll, csvUrl } =
  useFormSubmissions()
const downloading = ref(false)
const { confirm } = useModal()

const selected = ref<string | null>(props.formId ?? null)
const rows = ref<Submission[]>([])
const columns = ref<{ name: string; kind: string }[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)

const current = computed(() => forms.value.find((f) => f.formId === selected.value) ?? null)

onMounted(async () => {
  try {
    await loadForms()
    if (!selected.value) selected.value = forms.value[0]?.formId ?? null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load forms'
  }
})

/**
 * `immediate`, which is the whole point when a form is PRESELECTED.
 *
 * Opened from the Data panel the modal is given a `formId`, so `selected`
 * already holds it when the watcher is installed — and a plain watcher does not
 * fire for its initial value. The list of forms loaded, the right one was
 * highlighted, and its rows never arrived.
 */
watch(selected, async (id) => {
  if (!id) return
  loading.value = true
  error.value = null
  try {
    const data = await loadSubmissions(id, { limit: 200 })
    rows.value = data.submissions
    columns.value = data.fields.length
      ? data.fields
      : // a form removed from the site has no declared fields any more; fall
        // back to whatever the stored rows actually carry, so its leads stay
        // readable rather than showing as empty rows
        [...new Set(rows.value.flatMap((r) => Object.keys(r.values)))].map((name) => ({
          name,
          kind: 'text',
        }))
    total.value = data.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load submissions'
  } finally {
    loading.value = false
  }
}, { immediate: true })

/** fetch + save, rather than a bare <a href>: the request needs the session
 *  cookie and the filename comes from the server's content-disposition */
async function downloadCsv() {
  const form = current.value
  if (!form || downloading.value) return
  downloading.value = true
  error.value = null
  try {
    const res = await fetch(csvUrl(form.formId))
    if (!res.ok) throw new Error('Download failed')
    downloadBlob(await res.blob(), filenameFrom(res, 'submissions.csv'))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Download failed'
  } finally {
    downloading.value = false
  }
}

const cell = (row: Submission, name: string) => {
  const value = row.values[name]
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return value ?? ''
}

async function removeOne(row: Submission) {
  if (!selected.value) return
  const ok = await confirm({
    title: 'Delete submission',
    message: 'Delete this submission? This cannot be undone.',
    confirmLabel: 'Delete',
  })
  if (!ok) return
  await deleteSubmission(selected.value, row.id)
  rows.value = rows.value.filter((r) => r.id !== row.id)
  total.value = Math.max(0, total.value - 1)
}

async function removeAll() {
  const id = selected.value
  if (!id) return
  const ok = await confirm({
    title: 'Delete every submission',
    message: `Delete all ${total.value} submissions for ${current.value?.name}? This cannot be undone. Download the CSV first if you need them.`,
    confirmLabel: 'Delete all',
  })
  if (!ok) return
  await deleteAll(id)
  rows.value = []
  total.value = 0
}

/** the one failing-delivery line worth putting in front of an admin */
const deliveryWarning = computed(() => {
  const d = current.value?.delivery ?? {}
  if (d.notify && !d.notify.ok) return `Email is failing: ${d.notify.error}`
  if (d.forward && !d.forward.ok) return `The webhook is failing: ${d.forward.error}`
  return null
})
</script>

<template>
  <ModalHost size="xl" @close="emit('close')">
    <ModalHeader title="Form submissions" @close="emit('close')" />
    <div class="flex min-h-0 flex-1">
      <!-- the forms -->
      <div class="w-56 shrink-0 overflow-y-auto border-r border-input">
        <button
          v-for="form in forms"
          :key="form.formId"
          type="button"
          class="flex w-full flex-col gap-0.5 border-b border-input px-3 py-2.5 text-left outline-none hover:bg-accent/20"
          :class="selected === form.formId && 'bg-accent/30'"
          @click="selected = form.formId"
        >
          <span class="flex items-center gap-1.5">
            <span class="truncate text-xs font-medium">{{ form.name }}</span>
            <span v-if="form.storageFull" class="shrink-0 text-[9px] text-danger">Full</span>
            <span v-else-if="!form.onSite" class="shrink-0 text-[9px] text-pending">Removed</span>
          </span>
          <span class="truncate text-[10px] text-muted-foreground">
            {{ form.count }} {{ form.count === 1 ? 'submission' : 'submissions' }}
            <template v-if="form.latestAt"> · {{ timeAgo(form.latestAt) }}</template>
          </span>
          <span v-if="form.spamDropped" class="truncate text-[10px] text-muted-foreground">
            {{ form.spamDropped }} spam dropped
          </span>
        </button>
        <EmptyListUI v-if="!forms.length">No forms yet.</EmptyListUI>
      </div>

      <!-- one form's rows -->
      <div class="flex min-w-0 flex-1 flex-col">
        <div
          v-if="current"
          class="flex shrink-0 items-center gap-2 border-b border-input px-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium">{{ current.name }}</p>
            <p class="truncate text-[10px] text-muted-foreground">
              {{ total }} stored · {{ formatBytes(current.bytes) }}
              <template v-if="current.routes.length"> · {{ current.routes.join(', ') }}</template>
            </p>
          </div>
          <ButtonUI
            variant="outline"
            size="xs"
            :icon="Download"
            :disabled="downloading || !total"
            @click="downloadCsv"
          >
            {{ downloading ? 'Saving…' : 'CSV' }}
          </ButtonUI>
          <ButtonUI
            variant="outline"
            size="xs"
            :icon="Trash2"
            :disabled="!total"
            class="text-danger"
            @click="removeAll"
          >
            Delete all
          </ButtonUI>
        </div>

        <p
          v-if="deliveryWarning"
          class="flex shrink-0 items-center gap-1.5 border-b border-input bg-danger/5 px-3 py-2 text-[10px] text-danger"
        >
          <TriangleAlert class="size-3.5 shrink-0" />
          {{ deliveryWarning }}
        </p>
        <p
          v-if="current?.storageFull"
          class="flex shrink-0 items-center gap-1.5 border-b border-input bg-danger/5 px-3 py-2 text-[10px] text-danger"
        >
          <TriangleAlert class="size-3.5 shrink-0" />
          Storage is full — new submissions are being refused. Download the CSV and delete some.
        </p>
        <p v-if="error" class="shrink-0 px-3 py-2 text-[10px] text-danger">{{ error }}</p>

        <div class="min-h-0 flex-1 overflow-auto">
          <table v-if="rows.length" class="w-full border-collapse text-left">
            <thead class="sticky top-0 bg-background">
              <tr class="border-b border-input">
                <th class="px-3 py-2 text-[10px] font-medium text-muted-foreground">Received</th>
                <th
                  v-for="col in columns"
                  :key="col.name"
                  class="px-3 py-2 font-mono text-[10px] font-medium text-muted-foreground"
                >
                  {{ col.name }}
                </th>
                <th class="w-8"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id" class="border-b border-input last:border-b-0">
                <td class="px-3 py-2 align-top text-[10px] whitespace-nowrap text-muted-foreground">
                  {{ timeAgo(row.at) }}
                </td>
                <!-- TEXT ONLY: these values are attacker-writable -->
                <td
                  v-for="col in columns"
                  :key="col.name"
                  class="max-w-64 px-3 py-2 align-top text-xs break-words"
                >
                  {{ cell(row, col.name) }}
                </td>
                <td class="px-1 py-2 align-top">
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="Trash2"
                    tooltip="Delete"
                    class="text-muted-foreground"
                    @click="removeOne(row)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-else-if="!loading && current"
            class="flex flex-col items-center gap-1.5 py-12 text-muted-foreground"
          >
            <Inbox class="size-6" />
            <p class="text-xs">Nothing submitted yet.</p>
          </div>
          <p v-else-if="loading" class="px-3 py-4 text-xs text-muted-foreground">Loading…</p>
        </div>
      </div>
    </div>
  </ModalHost>
</template>
