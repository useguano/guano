<script setup lang="ts">
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import StyleEffectEditor from '@/components/editor/effects/StyleEffectEditor.vue'
import TimelineEditor from '@/components/editor/effects/TimelineEditor.vue'
import { useEffects } from '@/composables/useEffects'
import type { EffectKind } from '@/lib/effectTriggers'

const props = defineProps<{ id: string; half?: EffectKind }>()

const { effectById, halfIds, addHalf } = useEffects()

const effect = computed(() => effectById(props.id))

const halves = computed(() => (effect.value ? halfIds(effect.value) : {}))

const shows = (kind: EffectKind) => !props.half || props.half === kind
</script>

<template>
  <div v-if="effect" class="flex flex-col">
    <section v-if="shows('interaction')" data-effect-half="interaction" :class="!half && 'border-b border-input'">
      <p v-if="!half" class="flex h-9 items-center px-2.5 section-label">
        Classes
      </p>
      <StyleEffectEditor v-if="halves.interactionId" :id="halves.interactionId!" />
      <div v-else class="px-2.5 py-2">
        <ButtonUI variant="ghost" size="xs" :icon="Plus" class="text-muted-foreground" @click="addHalf(effect, 'interaction')">
          Classes
        </ButtonUI>
      </div>
    </section>

    <section v-if="shows('animation')" data-effect-half="animation">
      <TimelineEditor v-if="halves.animationId" :id="halves.animationId!" />
      <div v-else class="px-2.5 py-2">
        <ButtonUI variant="ghost" size="xs" :icon="Plus" class="text-muted-foreground" @click="addHalf(effect, 'animation')">
          Motion
        </ButtonUI>
      </div>
    </section>
  </div>
</template>
