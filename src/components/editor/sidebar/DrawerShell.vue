<script setup lang="ts">
// The skeleton every docked drawer column shares (Pages, Components): a
// full-height panel whose centre is ONE surface with two layers — the list
// (search field + scrolling body) and a detail view that takes its place —
// swapped with a transform-only push rather than a hard cut. Both layers are
// absolutely positioned inside the box so nothing reflows mid-transition.
// Content stays the caller's: the body slot renders its own scroller (the
// Components tree is also a layer surface and needs its own attributes on
// it), `detail` the view that replaces the list, and `footer` anything pinned
// under both — kept out of the swap on purpose, since Pages' locale switcher
// must stay reachable from the item editor.
import { ref } from 'vue'
import { Search } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    /** when true the detail layer shows instead of the list */
    detail?: boolean
    placeholder?: string
  }>(),
  { detail: false, placeholder: 'Search…' },
)

const query = defineModel<string>('query', { default: '' })

// the panel root, for useDrawerEscape's "did the last click land inside me"
const el = ref<HTMLElement>()
defineExpose({ el })
</script>

<template>
  <div ref="el" class="flex h-full flex-col bg-background">
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <Transition name="drawer-push">
        <div v-if="detail" class="pane pane-settings custom-scrollbar overflow-y-auto">
          <slot name="detail" />
        </div>

        <div v-else class="pane pane-list flex flex-col">
          <div class="relative shrink-0 p-2">
            <Search class="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="query"
              type="text"
              spellcheck="false"
              :placeholder="placeholder"
              class="h-9 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <slot />
        </div>
      </Transition>
    </div>

    <slot name="footer" />
  </div>
</template>

<style scoped>
/* the two swap layers stack rather than displace each other */
.pane {
  position: absolute;
  inset: 0;
}
.drawer-push-enter-active,
.drawer-push-leave-active {
  transition:
    transform 0.18s ease-out,
    opacity 0.18s ease-out;
}
/* the detail is the deeper layer: it arrives from and leaves to the right */
.pane-settings.drawer-push-enter-from,
.pane-settings.drawer-push-leave-to {
  transform: translateX(0.75rem);
  opacity: 0;
}
.pane-list.drawer-push-enter-from,
.pane-list.drawer-push-leave-to {
  transform: translateX(-0.75rem);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .drawer-push-enter-active,
  .drawer-push-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
