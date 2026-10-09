<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileText, Image as ImageIcon, LibraryBig, Music, Type, Upload } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useMedia, kindOfMime } from '@/composables/useMedia'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { acceptFor } from '@/lib/media'
import type { MediaKind } from '@/types/media'

const props = defineProps<{
  kind: MediaKind
  kinds?: MediaKind[]

  compact?: boolean
}>()
const model = defineModel<string>({ default: '' })

const { assetForSrc, thumbUrl, mediaUrl, upload } = useMedia()
const { openSelect } = useMediaLibrary()

const pickKinds = computed(() => props.kinds ?? [props.kind])
const asset = computed(() => assetForSrc(model.value))
const assetKind = computed(() => (asset.value ? kindOfMime(asset.value.mime) : null))

const KIND_ICONS = { font: Type, audio: Music, document: FileText } as const
const placeholderIcon = computed(
  () => KIND_ICONS[(assetKind.value ?? props.kind) as keyof typeof KIND_ICONS] ?? ImageIcon,
)

async function choose() {
  const picked = await openSelect(pickKinds.value)
  if (picked) model.value = mediaUrl(picked)
}

const fileInput = ref<HTMLInputElement>()
const busy = ref(false)
const error = ref<string | null>(null)

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  busy.value = true
  error.value = null
  try {
    model.value = mediaUrl(await upload(file))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'upload failed'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg bg-input p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      @click="choose"
    >
      <span class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60">
        <img v-if="asset && assetKind === 'image'" :src="thumbUrl(asset)" :alt="asset.name" class="size-full object-cover" />
        <video
          v-else-if="asset && assetKind === 'video'"
          :src="mediaUrl(asset)" preload="metadata" muted
          class="size-full object-cover"
        />
        <component v-else :is="placeholderIcon" class="size-4 text-muted-foreground" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-xs">{{ asset?.name ?? 'No file selected' }}</span>
        <span class="block text-[10px] text-muted-foreground">
          {{ asset ? asset.mime : 'Pick from the library' }}
        </span>
      </span>
    </button>

    <div v-if="!compact" class="flex gap-1.5">
      <ButtonUI variant="outline" size="sm" :icon="LibraryBig" class="flex-1" @click="choose">
        Choose
      </ButtonUI>
      <ButtonUI
        variant="outline" size="sm" :icon="Upload"
        class="flex-1"
        :disabled="busy"
        @click="fileInput?.click()"
      >
        {{ busy ? 'Uploading…' : 'Upload' }}
      </ButtonUI>
    </div>
    <input ref="fileInput" type="file" :accept="acceptFor(pickKinds)" class="hidden" @change="onFile" />
    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
