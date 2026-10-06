<script setup lang="ts">
// The single editing shell. The bottom-right Edit / Play toggle (`ModeToggle`)
// switches the surface between Build (breakpoint canvas + full inspector) and
// Preview (full-site render, restricted sidebar) — shown as Edit and Play, the
// only names the user sees.
// The centre is either the open page or the components board (`canvas`), and
// the 16rem track beside the rail holds Pages or Components (`column`). Layers
// are edited inside those columns: a page's from its Edit icon in Pages, a
// component's by expanding its row in Components.
// Contributors are pinned to Play.
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

// The centre has three faces and shows one at a time, so the other two need
// not be in the chunk that boots the editor: the board is only reached from
// Components, and Play is a mode you switch into (a contributor lands there,
// one request later).
const ComponentsBoard = defineAsyncComponent(
  () => import('@/components/editor/canvas/ComponentsBoard.vue'),
)
const SitePreview = defineAsyncComponent(() => import('@/components/site/SitePreview.vue'))

// editor-zone globals: keymaps live here (NOT in App.vue) so the public
// site never boots them. Structural shortcuts self-gate to Build mode.
useEditorShortcuts()
// here rather than in main.ts: there is nothing unsaved on /login or /setup,
// and a guard there would be a bug
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

      <!-- center: Build canvas or full-site preview, with the Edit / Play
           toggle floating over whichever is up, and the effects drawer docked
           UNDER it. A column, not an overlay: the drawer pushes the canvas up
           rather than covering the work, and it leaves both bottom corners
           alone — Insert owns bottom-left, the mode toggle bottom-right. -->
      <div class="flex h-full min-h-0 flex-col">
        <div class="relative min-h-0 flex-1">
          <template v-if="isBuild">
            <ComponentsBoard v-if="showComponents" />
            <CanvasEditor v-else />
          </template>
          <SitePreview v-else />

          <!-- Bottom RIGHT: the bottom-left corner is the InsertDock's, and
               the two must not share it — Insert belongs to the canvas, the
               mode belongs to the whole surface. A page's mode, so the board
               (nothing to play) doesn't get it, and neither does a
               contributor, who is pinned to Play with no switch to offer.
               Switching must not move it, or it slides out from under the
               pointer that just clicked it: Play's extra 9px pays back the
               framed pane's my-2 + border, which the unframed one doesn't
               have. -->
          <ModeToggle
            v-if="canBuild && !showComponents"
            class="absolute right-1 z-40"
            :class="isBuild ? 'bottom-1' : 'bottom-[13px]'"
          />
        </div>

        <!-- an effect is shared by every element using it, so it is edited on
             its own surface instead of taking the element panel over -->
        <EffectsDrawer v-if="canBuild && isBuild" />
      </div>
      <template v-if="isBuild">
        <ContextMenu />
        <InsertDragChip />
      </template>

      <template #right>
        <SettingsEditor />
      </template>
    </EditorLayout>

    <!-- The boot screen sits OVER the editor rather than before it: the shell
         mounts underneath the moment the store is hydrated, and the screen
         fades off it — so the first thing seen is the editor settling into
         place, not a hard cut from logo to chrome. -->
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
  /* keep the pointer on the editor while the screen is still fading */
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
