<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Bold, Italic, Link2, List } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { sanitizeRich } from '@/lib/shared/richtext.js'

const props = defineProps<{
  modelValue: string
  placeholder?: string

  compact?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editor = ref<HTMLElement>()
const focused = ref(false)

function syncIn() {
  const el = editor.value
  if (!el || focused.value) return
  const html = sanitizeRich(props.modelValue)
  if (el.innerHTML !== html) el.innerHTML = html
}
onMounted(syncIn)
watch(() => props.modelValue, syncIn)

function isBlank(html: string): boolean {
  if (/<hr\b/i.test(html)) return false
  return !html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim()
}

function emitOut() {
  const html = sanitizeRich(editor.value?.innerHTML ?? '')
  emit('update:modelValue', isBlank(html) ? '' : html)
}

function exec(command: string, value?: string) {
  editor.value?.focus()
  document.execCommand(command, false, value)
  emitOut()
}

function makeLink() {
  const url = window.prompt('Link URL (https://… or /page)')
  if (url) exec('createLink', url)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') e.stopPropagation()
}

defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="!disabled" class="flex gap-1">
      <ButtonUI variant="ghost" size="xs" :icon="Bold" tooltip="Bold (⌘B)" @click="exec('bold')" />
      <ButtonUI variant="ghost" size="xs" :icon="Italic" tooltip="Italic (⌘I)" @click="exec('italic')" />
      <ButtonUI variant="ghost" size="xs" :icon="Link2" tooltip="Link" @click="makeLink" />
      <ButtonUI variant="ghost" size="xs" :icon="List" tooltip="Bullet list" @click="exec('insertUnorderedList')" />
    </div>
    <div
      ref="editor"
      :contenteditable="!disabled"
      class="w-full rounded-lg border border-accent bg-transparent px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/25 [&_a]:underline [&_li]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal"
      :class="[compact ? 'min-h-20' : 'min-h-52', disabled && 'opacity-50']"
      :data-placeholder="placeholder"
      @focus="focused = true"
      @blur="((focused = false), emitOut())"
      @input="emitOut"
      @keydown="onKeydown"
    ></div>
  </div>
</template>
