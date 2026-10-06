<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import {
  Component, Files, Image, Settings, UserRound, LogOut,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useModal } from '@/composables/useModal'
import { useAuth } from '@/composables/useAuth'
import { useViewMode } from '@/composables/useViewMode'

// opened on demand, never on first paint — split out of the editor chunk
const SettingsPanel = defineAsyncComponent(() => import('@/components/shared/SettingsPanel.vue'))

const { openLibrary } = useMediaLibrary()
const { openModal } = useModal()
const { canBuild, logout } = useAuth()
const {
  isBuild, canvas, column, showComponents, pagesOpen,
  togglePages, toggleComponents, showApp,
} = useViewMode()
</script>

<template>
  <aside class="relative z-[60] flex h-full w-12 flex-col items-center gap-1 py-2 bg-background">
    <!-- App: the default surface — the page canvas, no column. Contributors
         are pinned to Play, so for them it stays a plain mark. -->
    <ButtonUI
      v-if="canBuild"
      variant="ghost"
      aria-label="App"
      class="w-7"
      :class="isBuild && canvas === 'page' && !column ? 'text-accent-foreground' : 'text-foreground'"
      @click="showApp"
    >
      <MainLogo class="size-4" />
    </ButtonUI>
    <div v-else class="flex py-2 w-7 items-center justify-center text-foreground">
      <MainLogo class="size-4" />
    </div>
    <div class="my-1 h-px w-full bg-input" />

    <ButtonUI
      variant="ghost"
      :icon="Files"
      aria-label="Pages"
      class="w-7"
      :class="pagesOpen ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="togglePages"
    />

    <!-- A Build-surface tool, so contributors — content-only, pinned to
         Play — don't get it. The Edit / Play switch itself is not a rail
         button: it lives on the canvas (`ModeToggle`), beside Insert. -->
    <ButtonUI
      v-if="canBuild"
      variant="ghost"
      :icon="Component"
      aria-label="Components"
      class="w-7"
      :class="showComponents ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="toggleComponents"
    />
    <ButtonUI
      variant="ghost"
      :icon="Image"
      aria-label="Media library"
      class="w-7 text-muted-foreground"
      @click="openLibrary()"
    />
    <ButtonUI
      variant="ghost"
      :icon="Settings"
      aria-label="Project settings"
      class="w-7 text-muted-foreground"
      @click="openModal(SettingsPanel)"
    />

    <ButtonUI
      variant="ghost"
      :icon="UserRound"
      aria-label="My account"
      class="mt-auto w-7 text-muted-foreground"
      @click="openModal(SettingsPanel, { initialSection: 'account' })"
    />
    <ButtonUI
      variant="ghost"
      :icon="LogOut"
      aria-label="Logout"
      class="w-7 text-muted-foreground"
      @click="logout"
    />
  </aside>
</template>
