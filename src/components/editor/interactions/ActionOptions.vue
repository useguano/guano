<script setup lang="ts">
// The ONE action a trigger runs on the selected element: WHERE it lands and how
// it is aimed. The drawer's trigger view shows this as its left column, beside
// the effect itself; removing the action and playing it belong to that view.
//
// The trigger is the view's heading, so the options only have to say WHERE the
// effect lands and (for a click) in WHICH direction. An action may be ONE effect
// wearing both engines: a class change that switches `display` and a timeline
// that moves it. The engine is never named, and when/where is written to EVERY
// half together — an effect whose two halves fired at different moments, or
// landed on different elements, would simply be broken.
import { computed } from 'vue'
import { Crosshair, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useProject } from '@/composables/useProject'
import { channelListeners } from '@/lib/shared/channels.js'
import { channelName, channelTargetId } from '@/lib/shared/interactionKeys.js'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { type EffectPair } from '@/composables/useEffects'
import { useSettings } from '@/composables/useSettings'
import { ACTION_VERBS, isDiscreteTrigger } from '@/lib/effectTriggers'
import { SCRUB_DEFAULTS } from '@/lib/motion'
import type { AnimationBinding, ElementNode } from '@/types/editor'

const props = defineProps<{ pair: EffectPair; owner: ElementNode }>()

const { getElement, highlightElement } = useElement()
const { findMasterNode } = useComponents()
const { breakpoints, project } = useProject()
const interactions = useInteraction()
const animations = useAnimation()
const { settings } = useSettings()
const { pickingFor } = interactions

const inter = computed(() => props.pair.interaction ?? null)
const anim = computed(() => props.pair.animation ?? null)
/** every binding this action stands for — one, or both halves of one effect */
const halves = computed(() => [inter.value, anim.value].filter((b) => !!b))
/** the half the options are READ from; writes go to all of them */
const primary = computed(() => inter.value ?? anim.value!)

/** at least one half still resolves in its library */
const resolved = computed(
  () =>
    (!!inter.value && !!interactions.animationFor(inter.value.interactionId)) ||
    (!!anim.value && !!animations.animationFor(anim.value.animationId)),
)
/** the element the timeline MOVES — what a `count` track writes into */
const movedElement = computed(() => {
  const id = anim.value?.targetId
  if (!id) return props.owner
  if (channelName(id)) return null // a channel: any element anywhere listens
  return getElement(id) ?? findMasterNode(id) ?? null
})
const error = computed(() => {
  const timeline = anim.value && animations.animationFor(anim.value.animationId)
  return timeline ? animations.animationError(timeline, movedElement.value) : null
})

/** only a click can be aimed: the symmetric triggers drive both directions
 *  themselves, which is why `action` is refused on them. Both engines answer a
 *  click the same way — a class change and a timeline are each keyed per
 *  (effect, target), so an Open button and a Close button drive one of either. */
const isDiscrete = computed(() => isDiscreteTrigger(primary.value.trigger))

function setAction(value: string | undefined) {
  const next = !value || value === 'toggle' ? undefined : (value as 'on' | 'off')
  for (const binding of halves.value) binding.action = next
}

// --- target ---

const hasTarget = computed(
  () => !!primary.value.targetId && primary.value.targetId !== props.owner.id,
)
/** a CHANNEL target is a name, not an element — it is reachable from anywhere
 *  in the project, so there is nothing on this canvas to point at */
const channel = computed(() => channelName(primary.value.targetId))
const targetName = computed(() => {
  if (channel.value) return `@${channel.value}`
  if (!hasTarget.value) return 'this element'
  const node = getElement(primary.value.targetId!) ?? findMasterNode(primary.value.targetId!)
  return node ? (node.ref ? `#${node.ref}` : node.type) : 'Missing'
})

/** every channel some element in the project declares, for the picker. A
 *  channel is the answer when the target is not on this page at all: one
 *  overlay opened from a header component on every route. */
const channelOptions = computed(() => [
  { label: 'An element…', value: '' },
  ...[...channelListeners(project.value).keys()].sort().map((name) => ({
    label: `@${name}`,
    value: name,
  })),
])
/** a tween shares one play per (animation, target) only on a CLICK, so that is
 *  the one trigger a channel accepts — see animationStateKey */
const channelAllowed = computed(() => !anim.value || anim.value.trigger === 'click')
function setChannel(name: string | undefined) {
  if (!name) {
    resetTarget()
    return
  }
  for (const binding of halves.value) binding.targetId = channelTargetId(name)
  clearPreview()
}
/** by MEMBERSHIP, not identity: a pending pick may be the array this made, and
 *  a computed hands back a fresh array every time it re-evaluates */
const picking = computed(() => interactions.pendingPicks().some((b) => halves.value.includes(b)))
function togglePicking() {
  pickingFor.value = picking.value ? null : [...halves.value]
}
function previewTarget() {
  if (hasTarget.value) highlightElement(primary.value.targetId!)
}
function clearPreview() {
  highlightElement(null)
}
function resetTarget() {
  for (const binding of halves.value) binding.targetId = null
  clearPreview()
}

// --- the kind-specific tail ---

const APPEAR_MODE_LABELS: Record<string, string> = {
  once: 'Once',
  replay: 'Every time',
  reverse: 'Reverse on exit',
}
// 'inherit' is the stored `undefined` — the site default
// (settings.motion.appearMode). Naming it keeps the distinction: writing the
// resolved value back would PIN every binding the moment it was shown.
const APPEAR_MODES = computed(() => [
  {
    label: `Site default (${APPEAR_MODE_LABELS[settings.value.motion?.appearMode ?? 'once']})`,
    value: 'inherit',
  },
  ...Object.entries(APPEAR_MODE_LABELS).map(([value, label]) => ({ label, value })),
])


// --- breakpoints (all active by default) ---

function isBreakpointOn(id: string): boolean {
  return !primary.value.breakpoints || primary.value.breakpoints.includes(id)
}
function toggleBreakpoint(id: string) {
  const all = breakpoints.value.map((b) => b.id)
  const on = new Set(primary.value.breakpoints ?? all)
  if (on.has(id)) {
    // keep at least one — an effect on no breakpoint can never run
    if (on.size <= 1) return
    on.delete(id)
  } else {
    on.add(id)
  }
  // canonicalize: all on → undefined (stays byte-identical); else project order
  const next = all.every((b) => on.has(b)) ? undefined : all.filter((b) => on.has(b))
  for (const binding of halves.value) binding.breakpoints = next
}

</script>

<template>
  <div data-binding-row class="flex flex-col gap-0.5">
    <template v-if="resolved">
      <RowUI label="On">
        <ButtonUI
          variant="outline" size="sm" :icon="Crosshair"
          class="min-w-0 flex-1 !justify-start"
          :class="picking && 'bg-accent text-accent-foreground'"
          @click="togglePicking"
          @mouseenter="previewTarget"
          @mouseleave="clearPreview"
        >
          <span class="truncate">{{ picking ? 'Click an element…' : targetName }}</span>
        </ButtonUI>
        <ButtonUI
          v-if="hasTarget"
          variant="icon" size="sm" :icon="X" tooltip="Back to this element"
          class="w-6 shrink-0 text-muted-foreground"
          @click="resetTarget"
        />
      </RowUI>

      <RowUI v-if="channelAllowed && channelOptions.length > 1" label="Channel">
        <SelectUI
          :model-value="channel ?? ''"
          :options="channelOptions"
          @update:model-value="setChannel"
        />
      </RowUI>

      <RowUI v-if="isDiscrete" label="Does">
        <SelectUI
          :model-value="primary.action ?? 'toggle'"
          :options="ACTION_VERBS"
          @update:model-value="setAction"
        />
      </RowUI>

      <RowUI v-if="inter && inter.trigger === 'scrolled'" label="After">
        <InputUI
          type="number"
          :model-value="String(inter.scrollAt ?? 50)"
          @update:model-value="(v) => (inter!.scrollAt = Number(v) || undefined)"
        />
        <span class="w-6 shrink-0 text-right text-xs text-muted-foreground">px</span>
      </RowUI>

      <template v-if="anim">
        <!-- the wait between the trigger and the timeline; a scrub has no
             moment to wait from, so it is not offered there -->
        <RowUI v-if="anim.trigger !== 'scrub'" label="Delay">
          <InputUI
            type="number"
            :model-value="String(anim.delay ?? 0)"
            @update:model-value="(v) => (anim!.delay = Math.max(0, Math.round(Number(v))) || undefined)"
          />
          <span class="w-6 shrink-0 text-right text-xs text-muted-foreground">ms</span>
        </RowUI>
        <template v-if="anim.trigger === 'appear'">
          <RowUI label="Replay">
            <SelectUI
              :options="APPEAR_MODES"
              :model-value="anim.appearMode ?? 'inherit'"
              @update:model-value="
                (v) => (anim!.appearMode = v === 'inherit' ? undefined : (v as AnimationBinding['appearMode']))
              "
            />
          </RowUI>
          <RowUI label="Starts at">
            <ValueFieldUI
              :model-value="String(anim.appearAt ?? 0)"
              @commit="(t) => (anim!.appearAt = parseFloat(t) > 0 ? Math.min(1, parseFloat(t)) : undefined)"
            />
            <span class="text-[10px] text-muted-foreground">× viewport</span>
          </RowUI>
        </template>
        <template v-if="anim.trigger === 'scrub'">
          <RowUI label="From">
            <ValueFieldUI
              :model-value="String(anim.scrub?.start ?? SCRUB_DEFAULTS.start)"
              @commit="(t) => (anim!.scrub = { ...anim!.scrub, start: parseFloat(t) || 0 })"
            />
            <span class="text-[10px] text-muted-foreground">× viewport</span>
          </RowUI>
          <RowUI label="To">
            <ValueFieldUI
              :model-value="String(anim.scrub?.end ?? SCRUB_DEFAULTS.end)"
              @commit="(t) => (anim!.scrub = { ...anim!.scrub, end: parseFloat(t) || 0 })"
            />
            <span class="text-[10px] text-muted-foreground">× viewport</span>
          </RowUI>
        </template>
      </template>

      <RowUI v-if="breakpoints.length > 1" label="Screens">
        <div class="flex flex-1 flex-wrap justify-end gap-1">
          <ButtonUI
            v-for="bp in breakpoints"
            :key="bp.id"
            :variant="isBreakpointOn(bp.id) ? 'outline' : 'ghost'"
            size="xs"
            :class="isBreakpointOn(bp.id) ? '' : 'text-muted-foreground opacity-60'"
            @click="toggleBreakpoint(bp.id)"
          >
            {{ bp.name }}
          </ButtonUI>
        </div>
      </RowUI>

      <p v-if="error" class="px-2.5 text-[10px] text-danger">{{ error }}</p>
    </template>

    <!-- the effect was deleted from the library while bound here -->
    <p v-else class="px-2.5 text-[10px] text-muted-foreground">
      This effect no longer exists — remove the action.
    </p>
  </div>
</template>
