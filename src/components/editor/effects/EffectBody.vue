<script setup lang="ts">
// ONE effect, editable in full: what it does, and (unless the surface shows it
// in its own header) its name and who uses it.
//
// Shared by the drawer's two views. The effect view shows the one picked in the
// library; the trigger view shows the one the selected element's trigger runs,
// beside that action's options — so an effect is never "opened" from a row, it
// is simply there.
//
// Takes a kind + id and re-resolves, never an object: undo and a branch switch
// swap the whole project graph, so a held object would detach silently.
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import EffectEditor from '@/components/editor/effects/EffectEditor.vue'
import EffectNameField from '@/components/editor/effects/EffectNameField.vue'
import StyleEffectEditor from '@/components/editor/effects/StyleEffectEditor.vue'
import TimelineEditor from '@/components/editor/effects/TimelineEditor.vue'
import { useEffects } from '@/composables/useEffects'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffectsDrawer, type DrawerKind } from '@/composables/useEffectsDrawer'

const props = withDefaults(
  defineProps<{
    kind: DrawerKind
    id: string
    /** false when the surface puts the name in its own header */
    nameRow?: boolean
  }>(),
  { nameRow: true },
)

const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const { selected, openEffect } = useEffectsDrawer()

const wrapper = computed(() => (props.kind === 'effect' ? (effects.effectById(props.id) ?? null) : null))

/** the effect, or the lone half — gone means nothing to draw */
const effect = computed(() => {
  if (props.kind === 'effect') return wrapper.value
  return props.kind === 'interaction'
    ? (interactions.animationFor(props.id) ?? null)
    : (animations.animationFor(props.id) ?? null)
})

/**
 * Give a single-engine half its other half. A half that predates the pairing —
 * or one a preset or an agent made — is still one engine; one button completes
 * it, never mere selection: a library row you only looked at must not come back
 * changed. `addHalf` spreads the new half to every element already using it.
 */
function pairUp() {
  if (props.kind === 'effect') return
  const name = effect.value?.name ?? 'Effect'
  const wrapped = effects.wrap(props.kind, props.id, name)
  effects.addHalf(wrapped, props.kind === 'interaction' ? 'animation' : 'interaction')
  // the effect view was pointed at the half; point it at the whole
  if (selected.value?.kind === props.kind && selected.value.id === props.id) {
    openEffect('effect', wrapped.id)
  }
}
</script>

<template>
  <div v-if="effect" data-effect-body class="flex flex-col">
    <div v-if="nameRow" class="flex h-9 shrink-0 items-center border-b border-input px-2.5">
      <EffectNameField :kind="kind" :id="id" />
    </div>

    <EffectEditor v-if="kind === 'effect'" :id="id" />
    <template v-else>
      <StyleEffectEditor v-if="kind === 'interaction'" :id="id" />
      <TimelineEditor v-else :id="id" />
      <div class="border-t border-input px-2.5 py-2">
        <ButtonUI variant="ghost" size="xs" :icon="Plus" class="text-muted-foreground" @click="pairUp()">
          {{ kind === 'interaction' ? 'Motion' : 'Classes' }}
        </ButtonUI>
      </div>
    </template>
  </div>
</template>
