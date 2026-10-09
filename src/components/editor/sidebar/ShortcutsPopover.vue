<script setup lang="ts">
import { computed } from 'vue'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import { useAuth } from '@/composables/useAuth'

interface Shortcut {
  keys: string[]
  label: string
}
interface Group {
  label: string
  buildOnly?: boolean
  items: Shortcut[]
}

const GROUPS: Group[] = [
  {
    label: 'Anywhere',
    items: [
      { keys: ['⌘Z', '⌘⇧Z'], label: 'Undo / redo' },
      { keys: ['⌘S'], label: 'Save now' },
      { keys: ['⌘P'], label: 'Publish' },
      { keys: ['C'], label: 'Comment mode, then click' },
      { keys: ['Esc'], label: 'Peel one layer' },
    ],
  },
  {
    label: 'Edit only',
    buildOnly: true,
    items: [
      { keys: ['⌘E'], label: 'Insert dock' },
      { keys: ['⌘⇧E'], label: 'Effects drawer' },
      { keys: ['⌘C', '⌘X', '⌘V'], label: 'Copy / cut / paste' },
      { keys: ['⌘D'], label: 'Duplicate' },
      { keys: ['⌘G'], label: 'Wrap in a div' },
      { keys: ['⌫'], label: 'Delete' },
      { keys: ['⇧↑', '⇧↓'], label: 'Move one slot' },
    ],
  },
  {
    label: 'Canvas',
    buildOnly: true,
    items: [
      { keys: ['⌘+', '⌘-', '⌘0'], label: 'Zoom in / out / reset' },
      { keys: ['Space'], label: 'Hold and drag to pan' },
      { keys: ['⌘ wheel'], label: 'Zoom' },
    ],
  },
  {
    label: 'Layers tree, while focused',
    buildOnly: true,
    items: [
      { keys: ['↑', '↓'], label: 'Walk rows' },
      { keys: ['→', '←'], label: 'Expand / collapse' },
      { keys: ['⌘⇧↑', '⌘⇧↓'], label: 'Extend the selection' },
      { keys: ['S', 'D', 'I'], label: 'Style / Data / Interactions' },
      { keys: ['Enter'], label: 'Rename the row' },
    ],
  },
]

const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const keyLabel = (key: string) => (isApple ? key : key.replace('⌘', 'Ctrl ').replace('⇧', 'Shift '))

const { canBuild } = useAuth()
const groups = computed(() => GROUPS.filter((g) => canBuild.value || !g.buildOnly))
</script>

<template>
  <GroupPopover v-for="group in groups" :key="group.label" :label="group.label">
    <div
      v-for="item in group.items"
      :key="item.label"
      class="flex items-center justify-between gap-3 py-0.5"
    >
      <span class="min-w-0 text-xs text-muted-foreground">{{ item.label }}</span>
      <span class="flex shrink-0 items-center gap-1">
        <kbd
          v-for="key in item.keys"
          :key="key"
          class="rounded-md border border-input bg-muted/40 px-1.5 py-0.5 font-sans text-[11px] whitespace-nowrap text-foreground"
        >{{ keyLabel(key) }}</kbd>
      </span>
    </div>
  </GroupPopover>
</template>
