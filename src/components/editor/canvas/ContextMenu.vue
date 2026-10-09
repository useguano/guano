<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { Copy, ClipboardPaste, CopyPlus, Trash2, Palette, Zap, Component, Unlink, Group, Eye, EyeOff, type LucideIcon } from 'lucide-vue-next'
import { isComponentType } from '@/lib/components'
import { useComponents } from '@/composables/useComponents'
import { useStructure } from '@/composables/useStructure'
import { useModal } from '@/composables/useModal'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useContextMenu } from '@/composables/useContextMenu'

const CreateComponentModal = defineAsyncComponent(() => import('@/components/editor/canvas/CreateComponentModal.vue'))

const { masterFor, detachComponent, isHidden, setHidden } = useComponents()

const targetHidden = computed(() => !!target.value && isHidden(target.value))

const { backend } = useStructure()
const { openModal } = useModal()

const componentInstanceId = computed(() =>
  target.value ? (masterFor(target.value.id)?.instanceId ?? null) : null,
)

const instanceIsNested = computed(() => {
  const id = componentInstanceId.value
  return !!id && (masterFor(id)?.mirrors.length ?? 0) > 0
})

const {
  menu,
  target,
  targetIsBody,
  copiedBlock,
  copiedClasses,
  copiedInteractions,
  closeMenu,
  duplicate,
  copy,
  paste,
  remove,
  copyClasses,
  pasteClasses,
  copyInteractions,
  pasteInteractions,
  wrapSelection,
} = useContextMenu()

interface Item {
  label: string
  icon: LucideIcon
  run: () => void
  disabled?: boolean
  divider?: boolean
  shortcut?: string
}

const items = computed<Item[]>(() => [
  { label: 'Duplicate', icon: CopyPlus, run: duplicate, disabled: targetIsBody.value, shortcut: '⌘D' },
  { label: 'Copy', icon: Copy, run: copy, disabled: targetIsBody.value, shortcut: '⌘C' },
  { label: 'Paste', icon: ClipboardPaste, run: paste, disabled: !copiedBlock.value, shortcut: '⌘V' },
  { label: 'Delete', icon: Trash2, run: remove, disabled: targetIsBody.value, shortcut: '⌫' },
  { label: 'Wrap in div', icon: Group, run: wrapSelection, disabled: targetIsBody.value, shortcut: '⌘G', divider: true },
  {
    label: targetHidden.value ? 'Show' : 'Hide',
    icon: targetHidden.value ? Eye : EyeOff,
    run: () => target.value && setHidden(target.value, !targetHidden.value),
    disabled: targetIsBody.value,
  },
  { label: 'Copy style classes', icon: Palette, run: copyClasses, divider: true },
  { label: 'Paste style classes', icon: Palette, run: pasteClasses, disabled: copiedClasses.value === null },
  { label: 'Copy interactions', icon: Zap, run: copyInteractions, divider: true },
  { label: 'Paste interactions', icon: Zap, run: pasteInteractions, disabled: copiedInteractions.value === null },
  {
    label: 'Create component',
    icon: Component,
    run: () => {
      const targetId = menu.value?.targetId
      if (targetId) void openModal(CreateComponentModal, { targetId })
    },
    disabled:
      backend.value.kind !== 'page' ||
      targetIsBody.value ||
      isComponentType(target.value?.type ?? '') ||
      !!componentInstanceId.value,
    divider: true,
  },
  {
    label: 'Detach from component',
    icon: Unlink,
    run: () => componentInstanceId.value && detachComponent(componentInstanceId.value),
    disabled:
      backend.value.kind !== 'page' || !componentInstanceId.value || instanceIsNested.value,
  },
])

const position = computed(() => ({
  left: `${Math.min(menu.value?.x ?? 0, window.innerWidth - 220)}px`,
  top: `${Math.min(menu.value?.y ?? 0, window.innerHeight - items.value.length * 32 - 24)}px`,
}))

const menuEl = ref<HTMLElement>()

function onWindowPointerdown(e: PointerEvent) {
  if (!menu.value) return
  if (menuEl.value && e.target instanceof Node && menuEl.value.contains(e.target)) return
  closeMenu()
}

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerdown, true)
  window.addEventListener('keydown', onWindowKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerdown, true)
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>

<template>
  <div
    v-if="menu"
    ref="menuEl"
    class="fixed z-50 w-52 rounded-2xl border border-input bg-background p-1 shadow-md"
    :style="position"
    @contextmenu.prevent
  >
    <template v-for="item in items" :key="item.label">
      <div v-if="item.divider" class="my-1 h-px bg-input" />
      <ButtonUI
        variant="ghost"
        size="sm"
        :icon="item.icon"
        :disabled="item.disabled"
        class="w-full justify-start"
        @click="((item.run()), closeMenu())"
      >
        {{ item.label }}
        <span
          v-if="item.shortcut"
          class="ml-auto pl-4 font-mono text-[10px] text-muted-foreground"
          >{{ item.shortcut }}</span
        >
      </ButtonUI>
    </template>
  </div>
</template>
