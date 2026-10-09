<script setup lang="ts">
import { ImagePlus, Plus, X } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    label?: string
    accept?: string

    wide?: boolean
  }>(),
  { accept: 'image/*' },
)

const model = defineModel<string>({ default: '' })

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => (model.value = String(reader.result ?? ''))
  reader.readAsDataURL(file)
  input.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="wide ? 'w-full' : 'items-center'">
    <label
      class="group relative flex cursor-pointer items-center justify-center overflow-hidden rounded-xl border bg-input/40 transition-colors"
      :class="[
        wide ? 'aspect-video w-full max-w-64' : 'size-16',
        model ? 'border-input' : 'border-dashed border-input hover:border-foreground/40',
      ]"
      v-tooltip="model ? 'Replace' : undefined"
    >
      <img v-if="model" :src="model" :class="wide ? 'size-full object-cover' : 'size-8 object-contain'" />
      <component
        :is="wide ? ImagePlus : Plus"
        v-else
        class="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
      />
      <input type="file" :accept="accept" class="hidden" @change="onFile" />
      <template v-if="model">
        <button
          v-if="wide"
          type="button"
          class="absolute inset-0 flex cursor-pointer items-center justify-center bg-background/70 text-xs text-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
          @click.prevent.stop="model = ''"
        >
          Remove image
        </button>
        <button
          v-else
          type="button"
          aria-label="Remove"
          class="absolute top-1 right-1 flex size-4 cursor-pointer items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
          @click.prevent.stop="model = ''"
        >
          <X class="size-3" />
        </button>
      </template>
    </label>
    <span v-if="label" class="text-[10px] text-muted-foreground">{{ label }}</span>
  </div>
</template>
