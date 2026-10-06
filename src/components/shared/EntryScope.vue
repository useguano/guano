<script lang="ts">
import type { InjectionKey } from 'vue'
import type { Collection, CollectionEntry } from '@/types/editor'

export interface EntryContext {
  collection: Collection
  entry: CollectionEntry | null
  /** position within the repeating list */
  index?: number
  count?: number
}

export const entryKey: InjectionKey<EntryContext> = Symbol('entry')
</script>

<script setup lang="ts">
import { provide } from 'vue'
import type { Collection as C, CollectionEntry as E } from '@/types/editor'

const props = defineProps<{
  collection: C
  entry: E | null
  index?: number
  count?: number
}>()

provide(entryKey, props as EntryContext)
</script>

<template>
  <slot />
</template>
