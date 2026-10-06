<script setup lang="ts">
// A named effect in full: the classes it wears and the motion it runs, as two
// labelled bands of ONE thing.
//
// The two engines are not two sections the author chooses between. A panel that
// slides in needs `hidden` → `flex` (which no tween can do — the first frame
// after a display change does not animate) AND a slide (which no class swap can
// express without fighting the cascade); that split is ours. The bands are named
// for what they hold — CLASSES, MOTION — never for an engine. See useEffects for
// what is actually stored, which is only the name and the two ids.
//
// A new effect always has both halves. One made before that was so — by a
// preset, an agent, or an older project — may be missing one, and the missing
// half is a single button here: nothing is created merely by opening it, since a
// library row you only looked at must not come back changed.
//
// ▶ plays the motion on the selected element: a timeline has no element of its
// own, so the canvas needs one. Inside a component instance that is the MASTER
// node, which is what every renderer maps the instance's elements to.
import { computed } from 'vue'
import { Play, Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import StyleEffectEditor from '@/components/editor/effects/StyleEffectEditor.vue'
import TimelineEditor from '@/components/editor/effects/TimelineEditor.vue'
import { useEffects } from '@/composables/useEffects'
import { useAnimation } from '@/composables/useAnimation'
import { useComponents } from '@/composables/useComponents'
import { useMotion } from '@/composables/useMotion'

const props = defineProps<{ id: string }>()

const { effectById, halfIds, addHalf } = useEffects()
const { animationFor } = useAnimation()
const { editTarget } = useComponents()
const motion = useMotion()

const effect = computed(() => effectById(props.id))
/** a half whose library entry has gone counts as absent, so the editor offers
 *  to make it again rather than rendering nothing */
const halves = computed(() => (effect.value ? halfIds(effect.value) : {}))

const playTarget = computed(() => editTarget.value?.id ?? null)

function play() {
  const id = halves.value.animationId
  const animation = id ? animationFor(id) : null
  if (animation && playTarget.value) motion.preview(animation, playTarget.value)
}
</script>

<template>
  <div v-if="effect" class="flex flex-col">
    <!-- the classes worn while it is on -->
    <section data-effect-half="interaction" class="border-b border-input">
      <p class="flex h-7 items-center px-2.5 section-label">
        Classes
      </p>
      <StyleEffectEditor v-if="halves.interactionId" :id="halves.interactionId!" />
      <div v-else class="px-2.5 pb-2">
        <ButtonUI variant="ghost" size="xs" :icon="Plus" class="text-muted-foreground" @click="addHalf(effect, 'interaction')">
          Classes
        </ButtonUI>
      </div>
    </section>

    <!-- the timeline -->
    <section data-effect-half="animation">
      <div class="flex h-7 items-center gap-2 px-2.5">
        <p class="section-label">Motion</p>
        <ButtonUI
          v-if="halves.animationId"
          variant="ghost"
          size="xs"
          :icon="Play"
          :disabled="!playTarget"
          :tooltip="playTarget ? 'Play on the selected element' : 'Select an element to play it'"
          class="ml-auto text-muted-foreground"
          @click="play"
        >
          Play
        </ButtonUI>
      </div>
      <TimelineEditor v-if="halves.animationId" :id="halves.animationId!" />
      <div v-else class="px-2.5 pb-2">
        <ButtonUI variant="ghost" size="xs" :icon="Plus" class="text-muted-foreground" @click="addHalf(effect, 'animation')">
          Motion
        </ButtonUI>
      </div>
    </section>
  </div>
</template>
