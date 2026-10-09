<script setup lang="ts">
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
import type { EffectKind } from '@/lib/effectTriggers'

const props = withDefaults(
  defineProps<{
    kind: DrawerKind
    id: string
    nameRow?: boolean
    half?: EffectKind
  }>(),
  { nameRow: true },
)

const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const { selected, openEffect } = useEffectsDrawer()

const wrapper = computed(() => (props.kind === 'effect' ? (effects.effectById(props.id) ?? null) : null))

const effect = computed(() => {
  if (props.kind === 'effect') return wrapper.value
  return props.kind === 'interaction'
    ? (interactions.animationFor(props.id) ?? null)
    : (animations.animationFor(props.id) ?? null)
})

function pairUp() {
  if (props.kind === 'effect') return
  const name = effect.value?.name ?? 'Effect'
  const wrapped = effects.wrap(props.kind, props.id, name)
  effects.addHalf(wrapped, props.kind === 'interaction' ? 'animation' : 'interaction')
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

    <EffectEditor v-if="kind === 'effect'" :id="id" :half="half" />
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
