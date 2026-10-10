<script setup lang="ts">
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
import { MOUSE_AREAS, MOUSE_AXES, MOUSE_DEFAULTS, SCRUB_DEFAULTS } from '@/lib/motion'
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
const halves = computed(() => [inter.value, anim.value].filter((b) => !!b))
const primary = computed(() => inter.value ?? anim.value!)

const resolved = computed(
  () =>
    (!!inter.value && !!interactions.animationFor(inter.value.interactionId)) ||
    (!!anim.value && !!animations.animationFor(anim.value.animationId)),
)
const movedElement = computed(() => {
  const id = anim.value?.targetId
  if (!id) return props.owner
  if (channelName(id)) return null
  return getElement(id) ?? findMasterNode(id) ?? null
})
const error = computed(() => {
  const timeline = anim.value && animations.animationFor(anim.value.animationId)
  return timeline ? animations.animationError(timeline, movedElement.value) : null
})

const isDiscrete = computed(() => isDiscreteTrigger(primary.value.trigger))

const mouseAxis = computed(() => anim.value?.mouse?.axis ?? MOUSE_DEFAULTS.axis)
const mouseArea = computed(() => anim.value?.mouse?.area ?? MOUSE_DEFAULTS.area)

function setMouse(patch: Partial<NonNullable<AnimationBinding['mouse']>>) {
  const binding = anim.value
  if (!binding) return
  binding.mouse = { axis: mouseAxis.value, area: mouseArea.value, ...binding.mouse, ...patch }
}

function setAction(value: string | undefined) {
  const next = !value || value === 'toggle' ? undefined : (value as 'on' | 'off')
  for (const binding of halves.value) binding.action = next
}

const hasTarget = computed(
  () => !!primary.value.targetId && primary.value.targetId !== props.owner.id,
)

const channel = computed(() => channelName(primary.value.targetId))
const targetName = computed(() => {
  if (channel.value) return `@${channel.value}`
  if (!hasTarget.value) return 'this element'
  const node = getElement(primary.value.targetId!) ?? findMasterNode(primary.value.targetId!)
  return node ? (node.ref ? `#${node.ref}` : node.type) : 'Missing'
})

const channelOptions = computed(() => [
  { label: 'An element…', value: '' },
  ...[...channelListeners(project.value).keys()].sort().map((name) => ({
    label: `@${name}`,
    value: name,
  })),
])

const channelAllowed = computed(() => !anim.value || anim.value.trigger === 'click')
function setChannel(name: string | undefined) {
  if (!name) {
    resetTarget()
    return
  }
  for (const binding of halves.value) binding.targetId = channelTargetId(name)
  clearPreview()
}

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

const APPEAR_MODE_LABELS: Record<string, string> = {
  once: 'Once',
  replay: 'Every time',
  reverse: 'Reverse on exit',
}
const APPEAR_MODES = computed(() => [
  {
    label: `Site default (${APPEAR_MODE_LABELS[settings.value.motion?.appearMode ?? 'once']})`,
    value: 'inherit',
  },
  ...Object.entries(APPEAR_MODE_LABELS).map(([value, label]) => ({ label, value })),
])

function isBreakpointOn(id: string): boolean {
  return !primary.value.breakpoints || primary.value.breakpoints.includes(id)
}
function toggleBreakpoint(id: string) {
  const all = breakpoints.value.map((b) => b.id)
  const on = new Set(primary.value.breakpoints ?? all)
  if (on.has(id)) {
    if (on.size <= 1) return
    on.delete(id)
  } else {
    on.add(id)
  }
  const next = all.every((b) => on.has(b)) ? undefined : all.filter((b) => on.has(b))
  for (const binding of halves.value) binding.breakpoints = next
}

</script>

<template>
  <div data-binding-row class="flex flex-col gap-0.5">
    <template v-if="resolved">
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

      <RowUI v-if="anim && anim.trigger !== 'scrub' && anim.trigger !== 'mouse'" label="Delay">
        <InputUI
          inputmode="numeric"
          unit="ms"
          :model-value="String(anim.delay ?? 0)"
          @update:model-value="(v) => (anim!.delay = Math.max(0, Math.round(Number(v))) || undefined)"
        />
      </RowUI>

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

      <RowUI v-if="isDiscrete" label="Action">
        <SelectUI
          :model-value="primary.action ?? 'toggle'"
          :options="ACTION_VERBS"
          @update:model-value="setAction"
        />
      </RowUI>

      <RowUI v-if="inter && inter.trigger === 'scrolled'" label="After">
        <InputUI
          inputmode="numeric"
          unit="px"
          :model-value="String(inter.scrollAt ?? 50)"
          @update:model-value="(v) => (inter!.scrollAt = Number(v) || undefined)"
        />
      </RowUI>

      <template v-if="anim">

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
        <template v-if="anim.trigger === 'mouse'">
          <RowUI label="Axis">
            <div class="flex flex-1 justify-end gap-1">
              <ButtonUI
                v-for="axis in MOUSE_AXES"
                :key="axis"
                :variant="mouseAxis === axis ? 'outline' : 'ghost'"
                size="xs"
                :class="mouseAxis === axis ? '' : 'text-muted-foreground opacity-60'"
                @click="setMouse({ axis })"
              >
                {{ axis === 'x' ? 'Horizontal' : 'Vertical' }}
              </ButtonUI>
            </div>
          </RowUI>
          <RowUI label="Across">
            <div class="flex flex-1 justify-end gap-1">
              <ButtonUI
                v-for="area in MOUSE_AREAS"
                :key="area"
                :variant="mouseArea === area ? 'outline' : 'ghost'"
                size="xs"
                :class="mouseArea === area ? '' : 'text-muted-foreground opacity-60'"
                @click="setMouse({ area })"
              >
                {{ area === 'element' ? 'This element' : 'Whole page' }}
              </ButtonUI>
            </div>
          </RowUI>
          <RowUI label="Catch-up">
            <ValueFieldUI
              :model-value="String(anim.mouse?.smooth ?? MOUSE_DEFAULTS.smooth)"
              @commit="(t) => setMouse({ smooth: Math.max(0, Math.min(3, parseFloat(t) || 0)) })"
            />
            <span class="text-[10px] text-muted-foreground">s</span>
          </RowUI>
        </template>
      </template>

      <p v-if="error" class="px-2.5 text-[10px] text-danger">{{ error }}</p>
    </template>

    <p v-else class="px-2.5 text-[10px] text-muted-foreground">
      This effect no longer exists — remove the action.
    </p>
  </div>
</template>
