<script setup lang="ts">
import { RouterView } from 'vue-router'
import AgentLockHost from '@/components/host/AgentLockHost.vue'
import ModalStackHost from '@/components/host/ModalStackHost.vue'
import NoticeHost from '@/components/host/NoticeHost.vue'
import PopoverHost from '@/components/host/PopoverHost.vue'
import TooltipHost from '@/components/host/TooltipHost.vue'
</script>

<template>
  <RouterView />
  <AgentLockHost />
  <PopoverHost />
  <ModalStackHost />
  <TooltipHost />
  <NoticeHost />
</template>
