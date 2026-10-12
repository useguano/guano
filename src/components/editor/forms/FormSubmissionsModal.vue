<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronRight, Download, Inbox, Trash2, TriangleAlert } from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import EmptyListUI from '@/components/ui/EmptyListUI.vue'
import { useFormSubmissions, type Submission } from '@/composables/useFormSubmissions'
import { useModal } from '@/composables/useModal'
import { timeAgo } from '@/lib/time'
import { formatBytes } from '@/lib/media'
import { downloadBlob, filenameFrom } from '@/lib/download'

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

watch(selected, async (id) => {
  if (!id) return
  loading.value = true
  error.value = null
  try {
    const data = await loadSubmissions(id, { limit: 200 })
    rows.value = data.submissions
    columns.value = data.fields.length
      ? data.fields
      :
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

const query = ref('')

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter((row) =>
    Object.values(row.values).some((v) => String(v).toLowerCase().includes(needle)),
  )
})

const open = ref(new Set<string>())
const isOpen = (id: string) => open.value.has(id)
function toggle(id: string) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}

const norm = (key: string) => key.toLowerCase().replace(/[^a-z]/g, '')
const NAME_KEYS = ['name', 'fullname', 'firstname', 'yourname']
const EMAIL_KEYS = ['email', 'mail', 'emailaddress', 'youremail']

const filled = (row: Submission, key: string) => String(row.values[key] ?? '').trim().length > 0

function headlineKey(row: Submission): string | null {
  const keys = Object.keys(row.values)
  const match = (wanted: string[]) => keys.find((k) => wanted.includes(norm(k)) && filled(row, k))
  return match(NAME_KEYS) ?? match(EMAIL_KEYS) ?? keys.find((k) => filled(row, k)) ?? null
}

const headline = (row: Submission) => {
  const key = headlineKey(row)
  return key ? String(cell(row, key)) : 'Submission'
}

const received = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function detailKeys(row: Submission): string[] {
  const skip = headlineKey(row)
  const ordered = columns.value.map((c) => c.name)
  const extra = Object.keys(row.values).filter((k) => !ordered.includes(k))
  return [...ordered, ...extra].filter((k) => k !== skip)
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

const showRoute = computed(() => {
  const form = current.value
  if (!form) return true
  return form.routes.length > 1 || !form.onSite
})

const deliveryWarning = computed(() => {
  const d = current.value?.delivery ?? {}
  if (d.notify && !d.notify.ok) return `Email is failing: ${d.notify.error}`
  if (d.forward && !d.forward.ok) return `The webhook is failing: ${d.forward.error}`
  return null
})
</script>

<template>
  <ModalHost size="xl" @close="emit('close')">
    <div class="flex h-full flex-col">
      <ModalHeader
        v-model:search="query"
        title="Form submissions"
        :icon="Inbox"
        search-placeholder="Search submissions…"
        class="shrink-0"
        @close="emit('close')"
      />
      <div class="flex min-h-0 flex-1">
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

          <div class="min-h-0 flex-1 overflow-auto p-3">
            <div v-if="visible.length" class="flex flex-col rounded-xl border border-input">
              <div
                v-for="row in visible"
                :key="row.id"
                class="border-b border-input last:border-b-0"
              >
                <div
                  class="flex cursor-pointer items-center gap-2 px-3 py-2 select-none"
                  @click="toggle(row.id)"
                >
                  <ChevronRight
                    class="size-3.5 shrink-0 text-muted-foreground transition-transform"
                    :class="isOpen(row.id) && 'rotate-90'"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium">{{ headline(row) }}</p>
                    <p class="truncate text-[10px] text-muted-foreground">{{ received(row.at) }}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5" @click.stop>
                    <ButtonUI
                      variant="icon"
                      size="sm"
                      :icon="Trash2"
                      tooltip="Delete"
                      class="text-muted-foreground"
                      @click="removeOne(row)"
                    />
                  </div>
                </div>

                <div
                  v-if="isOpen(row.id)"
                  class="flex flex-col gap-2 border-t border-input px-3 py-2.5"
                >
                  <div v-for="key in detailKeys(row)" :key="key" class="flex flex-col gap-0.5">
                    <p class="font-mono text-[10px] text-muted-foreground">{{ key }}</p>
                    <p class="text-xs break-words whitespace-pre-wrap">
                      {{ cell(row, key) || '—' }}
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                    <span>{{ received(row.at) }} · {{ timeAgo(row.at) }}</span>
                    <span v-if="showRoute && row.route">from {{ row.route }}</span>
                    <span v-if="row.entry">entry {{ row.entry }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else-if="!loading && current"
              class="flex flex-col items-center gap-1.5 py-12 text-muted-foreground"
            >
              <Inbox class="size-6" />
              <p class="text-xs">
                {{ query.trim() && rows.length ? 'No submission matches that.' : 'Nothing submitted yet.' }}
              </p>
            </div>
            <p v-else-if="loading" class="py-4 text-xs text-muted-foreground">Loading…</p>
          </div>
        </div>
      </div>
    </div>
  </ModalHost>
</template>
