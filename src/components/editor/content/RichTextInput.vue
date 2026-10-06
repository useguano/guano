<script setup lang="ts">
// Minimal rich-text field for the Content panel: a contenteditable div
// with a bold/italic/link/list toolbar. The model value is always the
// sanitized HTML subset (lib/shared/richtext.js).
import { onMounted, ref, watch } from 'vue'
import { Bold, Italic, Link2, List } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { sanitizeRich } from '@/lib/shared/richtext.js'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  /** short box — stacked several deep in the 256px Pages drawer, the default
   *  13rem height is unusable */
  compact?: boolean
  /** read-only: a localize:false field under a non-default locale */
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

// A contenteditable emptied by the user is almost never "" — browsers leave a
// stray <br> (or <p><br></p>, or &nbsp;) behind. That markup survives
// sanitizeRich, so it would be stored as a real value: a cleared locale
// override would never be PRUNED, the default-locale fallback would never come
// back, and the entry/node would stop being byte-identical to one that was
// never touched (which is what keeps branch-merge signatures quiet). Normalize
// those carcasses to "". <hr> is the one tag that means something without text.
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

// execCommand is deprecated but universally supported — fine for this subset
function exec(command: string, value?: string) {
  editor.value?.focus()
  document.execCommand(command, false, value)
  emitOut()
}

function makeLink() {
  const url = window.prompt('Link URL (https://… or /page)')
  if (url) exec('createLink', url)
}

// keystrokes stay local to the contenteditable (editor shortcuts must not
// fire while writing) — except Escape, which bubbles so the panel's
// window-level handler can close the popover and return to the Layers tree
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
