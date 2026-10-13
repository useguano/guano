<script setup lang="ts">
import { defineAsyncComponent, watch } from 'vue'
import {
  Component, Files, Image, Inbox, Settings, UserRound, LogOut,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useProject } from '@/composables/useProject'
import { useFormAlerts } from '@/composables/useFormAlerts'
import { useModal } from '@/composables/useModal'
import { useAuth } from '@/composables/useAuth'
import { useViewMode } from '@/composables/useViewMode'

const SettingsPanel = defineAsyncComponent(() => import('@/components/shared/SettingsPanel.vue'))

const { openLibrary } = useMediaLibrary()
const { openModal } = useModal()
const { canBuild, logout } = useAuth()
const { hasEnabledForm } = useProject()
const { hasNew, newCount, refresh: refreshFormAlerts, openSubmissions } = useFormAlerts()
const {
  isBuild, canvas, column, showComponents, pagesOpen,
  togglePages, toggleComponents, showApp,
} = useViewMode()

watch(
  [canBuild, hasEnabledForm],
  ([may, has]) => {
    if (may && has) void refreshFormAlerts()
  },
  { immediate: true },
)
</script>

<template>
  <aside class="relative z-[60] flex h-full w-12 flex-col items-center gap-1 py-4 bg-background">

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
    <div v-if="canBuild && hasEnabledForm" class="relative flex">
      <ButtonUI
        variant="ghost"
        :icon="Inbox"
        :aria-label="hasNew ? `Form submissions, ${newCount} new` : 'Form submissions'"
        class="w-7 text-muted-foreground"
        @click="openSubmissions"
      />
      <span
        v-if="hasNew"
        class="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-success ring-2 ring-background"
      />
    </div>
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
