<script setup lang="ts">
import EditorLayout from '@/layouts/EditorLayout.vue'
import AppRail from '@/components/editor/sidebar/AppRail.vue'
import PagesDrawer from '@/components/editor/sidebar/PagesDrawer.vue'
import ComponentsDrawer from '@/components/editor/sidebar/ComponentsDrawer.vue'
import CanvasEditor from '@/components/editor/canvas/CanvasEditor.vue'
import SettingsEditor from '@/components/editor/sidebar/SettingsEditor.vue'
import ContextMenu from '@/components/editor/canvas/ContextMenu.vue'
import InsertDragChip from '@/components/editor/canvas/InsertDragChip.vue'
import ModeToggle from '@/components/editor/canvas/ModeToggle.vue'
import EffectsDrawer from '@/components/editor/effects/EffectsDrawer.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
import { useUnloadGuard } from '@/composables/useUnloadGuard'
import { useEditorBoot } from '@/composables/useEditorBoot'
import { useAuth } from '@/composables/useAuth'
import { useViewMode } from '@/composables/useViewMode'
import LoadingUI from '@/components/ui/LoadingUI.vue'
import { defineAsyncComponent } from 'vue'

const ComponentsBoard = defineAsyncComponent(
  () => import('@/components/editor/canvas/ComponentsBoard.vue'),
)
const SitePreview = defineAsyncComponent(() => import('@/components/site/SitePreview.vue'))

useEditorShortcuts()
useUnloadGuard()

const { ready, bootError, reloadPage } = useEditorBoot()
const { canBuild } = useAuth()
const { isBuild, visibleColumn, showComponents } = useViewMode()
</script>

<template>
  <div
    v-if="bootError"
    class="flex min-h-screen flex-col items-center justify-center gap-3 bg-background"
  >
    <p class="text-sm font-medium">{{ bootError }}</p>
    <ButtonUI variant="outline" size="sm" @click="reloadPage">Retry</ButtonUI>
  </div>

  <template v-else>
    <EditorLayout v-if="ready" :column="visibleColumn" :framed="isBuild">
      <template #rail>
        <AppRail />
      </template>

      <template v-if="visibleColumn === 'pages'" #pages>
        <PagesDrawer />
      </template>

      <template v-if="visibleColumn === 'components'" #components>
        <ComponentsDrawer />
      </template>

      <div class="flex h-full min-h-0 flex-col">
        <div class="relative min-h-0 flex-1">
          <template v-if="isBuild">
            <ComponentsBoard v-if="showComponents" />
            <CanvasEditor v-else />
          </template>
          <SitePreview v-else />

          <ModeToggle
            v-if="canBuild && !showComponents"
            class="absolute right-1 z-40"
            :class="isBuild ? 'bottom-1' : 'bottom-[13px]'"
          />
        </div>

        <EffectsDrawer v-if="canBuild && isBuild" />
      </div>
      <ContextMenu v-if="canBuild" />
      <InsertDragChip v-if="isBuild" />

      <template #right>
        <SettingsEditor />
      </template>
    </EditorLayout>

    <Transition name="boot">
      <LoadingUI v-if="!ready" page class="fixed inset-0 z-[60]" />
    </Transition>
  </template>
</template>

<style scoped>
.boot-leave-active {
  transition:
    opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}
.boot-leave-to {
  opacity: 0;
  transform: scale(1.04);
}

@media (prefers-reduced-motion: reduce) {
  .boot-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
