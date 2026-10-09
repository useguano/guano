<script setup lang="ts">
import GroupPopover from '@/components/popover/GroupPopover.vue'
import StyleEditor from '@/components/editor/style/StyleEditor.vue'
import InteractionsEditor from '@/components/editor/interactions/InteractionsEditor.vue'
import BranchesEditor from '@/components/editor/drafts/BranchesEditor.vue'
import DataEditor from '@/components/editor/content/DataEditor.vue'
import { usePanel } from '@/composables/usePanel'
import { useElement } from '@/composables/useElement'

const { activePanelId } = usePanel()
const { selectedElement, isMultiSelect } = useElement()
</script>

<template>
  <template v-if="activePanelId === 'data'">
    <DataEditor v-if="selectedElement && !isMultiSelect" />
    <GroupPopover v-else>
      <p class="text-xs text-muted-foreground">Select a single element to edit its data.</p>
    </GroupPopover>
  </template>

  <template v-else-if="activePanelId === 'style'">
    <StyleEditor v-if="selectedElement && !isMultiSelect" />
    <GroupPopover v-else>
      <p class="text-xs text-muted-foreground">Select a single element to style it.</p>
    </GroupPopover>
  </template>

  <InteractionsEditor v-else-if="activePanelId === 'interactions'" />

  <BranchesEditor v-else-if="activePanelId === 'branches'" />

  <GroupPopover v-else>
    <p class="text-xs text-muted-foreground">Nothing here yet.</p>
  </GroupPopover>
</template>
