<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import { RotateCcw, X } from 'lucide-vue-next'
import { STYLE_SECTIONS } from '@/lib/styleCatalog'
import { STYLE_ICONS } from '@/lib/styleCatalogIcons'
import {
  matchClass,
  sliderClasses,
  sliderLabels,
  sliderPrefix,
  sliderAllowNegative,
  isPropertyRelevant,
  hasDisplayClass,
  mergeClassLayers,
} from '@/lib/styles'
import { pickedKeys } from '@/lib/variants'
import { setVariantClasses } from '@/lib/variantOps'
import { useVariants } from '@/composables/useVariants'
import { classToText, textToClass, nearestStepIndex, sizeClassToText, namedTextToClass } from '@/lib/valueClass'
import { isPaletteColor } from '@/lib/colors'
import type { StyleProperty, Control, StyleSection, RelevanceContext } from '@/lib/styles'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useProject } from '@/composables/useProject'
import { useClassField } from '@/composables/useClassField'
import { useSettings } from '@/composables/useSettings'
import { breakpointView, applyBreakpointEdit, removeInheritedToken } from '@/lib/responsive'
import { findParent } from '@/lib/tree'
import GroupAccordion from '@/components/accordion/GroupAccordion.vue'
import TitleAccordion from '@/components/accordion/TitleAccordion.vue'
import ContentAccordion from '@/components/accordion/ContentAccordion.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import ClassInput from '@/components/editor/style/ClassInput.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import ColorFieldUI from '@/components/editor/style/ColorFieldUI.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import SpacingBoxControl from '@/components/editor/style/SpacingBoxControl.vue'
import BorderStyleControl from '@/components/editor/style/BorderStyleControl.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import IconGroupUI from '@/components/ui/IconGroupUI.vue'
import SpacingControl from '@/components/editor/style/SpacingControl.vue'
import AlignGridControl from '@/components/editor/style/AlignGridControl.vue'
import GapControl from '@/components/editor/style/GapControl.vue'
import InsetControl from '@/components/editor/style/InsetControl.vue'
import SizeControl from '@/components/editor/style/SizeControl.vue'
import { borderWidthScheme } from '@/lib/tieredBox'

const { selectedElement, elements } = useElement()
const { masterFor, editTarget } = useComponents()
const { activeBreakpoint, baseBreakpoint, breakpoints } = useProject()

const activeWidth = computed(() => {
  const a = activeBreakpoint.value
  if (!a || a.id === baseBreakpoint.value?.id) return null
  return a.width
})

const baseWidth = computed(() => baseBreakpoint.value?.width ?? 0)

const nextLargerWidth = computed(() => {
  const w = activeWidth.value
  if (w === null) return null
  const wider = breakpoints.value.map((b) => b.width).filter((x) => x > w)
  return wider.length ? Math.min(...wider) : null
})

const styleTarget = editTarget

const { activeLayer, layer, layerOptions, selectionContext } = useVariants()

const split = (classes: string | undefined) => (classes ?? '').split(/\s+/).filter(Boolean)

const layerContext = computed(() => {
  const ctx = selectionContext.value
  const target = styleTarget.value
  if (!layer.value || !ctx || !target) return null
  const others = pickedKeys(ctx.def, ctx.picks)
    .filter((key) => key !== layer.value)
    .map((key) => target.variantClasses?.[key])
  return mergeClassLayers(target.classes ?? '', ...others)
})
const contextTokens = computed(() => new Set(split(layerContext.value ?? '')))

const layerChoices = computed(() => [
  { label: 'Base', value: '' },
  ...layerOptions.value.map((l) => ({ label: `${l.axis}: ${l.option}`, value: l.key })),
])

function pickLayer(key: string) {
  activeLayer.value = key || null
}

const { tokens: rawTokens, setTokens: setRawTokens } = useClassField({
  get: () => {
    const target = styleTarget.value
    if (!target) return ''
    if (layerContext.value === null) return target.classes ?? ''
    return mergeClassLayers(layerContext.value, target.variantClasses?.[layer.value!])
  },
  set: (value) => {
    const target = styleTarget.value
    if (!target) return
    const ctx = selectionContext.value
    if (layerContext.value === null || !ctx || !layer.value) {
      target.classes = value
      return
    }
    const own = split(value).filter((token) => !contextTokens.value.has(token))
    setVariantClasses(ctx.def, target, layer.value, own.join(' '))
  },
})
const view = computed(() => breakpointView(rawTokens.value, activeWidth.value, baseWidth.value))
const tokens = computed(() => view.value.tokens)
function setTokens(next: string[]) {
  setRawTokens(applyBreakpointEdit(rawTokens.value, activeWidth.value, next, baseWidth.value))
}
function removeToken(cls: string) {
  if (layerInherited.value.includes(cls)) return
  if (activeWidth.value !== null && inheritedTokens.value.includes(cls)) {
    const larger = nextLargerWidth.value
    if (larger !== null) {
      const next = removeInheritedToken(rawTokens.value, cls, larger)
      if (next) setRawTokens(next)
    }
    return
  }
  setTokens(tokens.value.filter((t) => t !== cls))
}

const layerInherited = computed(() =>
  layerContext.value === null ? [] : tokens.value.filter((t) => contextTokens.value.has(t)),
)
const inheritedTokens = computed(() => [
  ...new Set([...view.value.inherited, ...layerInherited.value]),
])

const removableInherited = computed(() =>
  activeWidth.value === null
    ? []
    : view.value.inherited.filter(
        (t) => rawTokens.value.includes(t) && !layerInherited.value.includes(t),
      ),
)

function classFor(prop: StyleProperty): string | undefined {
  return matchClass(prop, tokens.value)
}

function set(prop: StyleProperty, cls: string) {
  const next = [...tokens.value]
  const current = classFor(prop)
  const at = current ? next.indexOf(current) : -1
  if (at === -1) next.push(cls)
  else next[at] = cls
  setTokens(next)
}

function isDisplayDependent(cls: string): boolean {
  return allProps.some((p) => p.needsDisplay && !!matchClass(p, [cls])) || cls.startsWith('gap-')
}

function remove(prop: StyleProperty) {
  const current = classFor(prop)
  if (!current) return
  let next = tokens.value.filter((cls) => cls !== current)
  if (prop.id === 'display') next = next.filter((cls) => !isDisplayDependent(cls))
  setTokens(next)
}

const baseline = ref<string[]>([])
const backgroundBaseline = ref<string>('')
watch(
  [() => styleTarget.value?.id, activeWidth, layer],
  () => {
    baseline.value = breakpointView(rawTokens.value, activeWidth.value, baseWidth.value).tokens
    backgroundBaseline.value = styleTarget.value?.background ?? ''
  },
  { immediate: true },
)

function baselineClassFor(prop: StyleProperty): string | undefined {
  return matchClass(prop, baseline.value)
}

function isDirty(prop: StyleProperty): boolean {
  return (classFor(prop) ?? '') !== (baselineClassFor(prop) ?? '')
}

function revert(prop: StyleProperty) {
  const base = baselineClassFor(prop)
  if (base) set(prop, base)
  else remove(prop)
}

const openSections = ref<Record<string, boolean>>(
  Object.fromEntries(STYLE_SECTIONS.map((s) => [s.id, false])),
)

const allProps = STYLE_SECTIONS.flatMap((s) => s.properties)
const propById = (id: string) => allProps.find((p) => p.id === id)!
const displayProp = propById('display')
const positionProp = propById('position')
const transitionProp = propById('transition')
const directionProp = propById('direction')

const isVerticalFlex = computed(() => {
  const d = matchClass(directionProp, tokens.value)
  return d === 'flex-col' || d === 'flex-col-reverse'
})

watch(
  tokens,
  () => {
    const own = tokens.value.filter((t) => !inheritedTokens.value.includes(t))
    const needsDisplay = allProps.some((p) => p.needsDisplay && matchClass(p, own))
    if (needsDisplay && !hasDisplayClass(tokens.value)) {
      setTokens(['flex', ...tokens.value])
    }
  },
  { immediate: true },
)

const parentDisplay = computed(() => {
  const id = selectedElement.value?.id
  if (!id) return undefined
  const parent = findParent(elements.value, id)
  if (!parent) return undefined
  const parentClasses = (masterFor(parent.id)?.master ?? parent).classes ?? ''
  return matchClass(displayProp, parentClasses.split(/\s+/).filter(Boolean))
})

const relevanceContext = computed<RelevanceContext>(() => {
  const transition = matchClass(transitionProp, tokens.value)
  return {
    display: matchClass(displayProp, tokens.value),
    position: matchClass(positionProp, tokens.value),
    parentDisplay: parentDisplay.value,
    hasTransition: !!transition && transition !== 'transition-none',
    isMedia: ['image', 'video'].includes(selectedElement.value?.type ?? ''),
    hasBackground: !!styleTarget.value?.background,
  }
})

const backgroundMedia = computed<string>({
  get: () => styleTarget.value?.background ?? '',
  set: (v) => {
    if (styleTarget.value) styleTarget.value.background = v || undefined
  },
})

function isVisible(prop: StyleProperty): boolean {
  const relevant = isPropertyRelevant(prop, relevanceContext.value)
  const r = prop.relevance
  if (r && (r.when === 'display' || r.when === 'parentDisplay') && !relevant) {
    return false
  }
  return !!classFor(prop) || relevant
}

const GRID_COVERED = new Set([
  'justify',
  'align-content',
  'justify-self',
  'right',
  'bottom',
  'left',
])

function visibleProps(section: StyleSection): StyleProperty[] {
  return section.properties.filter((p) => !GRID_COVERED.has(p.id) && isVisible(p))
}

const ALWAYS_SHOWN = new Set(['spacing', 'size'])
const visibleSections = computed(() =>
  STYLE_SECTIONS.filter((s) => ALWAYS_SHOWN.has(s.id) || visibleProps(s).length > 0),
)

function control<K extends Control['kind']>(prop: StyleProperty, kind: K) {
  return prop.control as Extract<Control, { kind: K }>
}

function selectOptions(prop: StyleProperty) {
  return control(prop, 'select').options.map((o) => ({ label: o.label, value: o.class }))
}

function sliderIndex(prop: StyleProperty): number {
  const slider = control(prop, 'slider')
  const classes = sliderClasses(slider)
  const current = classFor(prop)
  if (current) {
    const index = classes.indexOf(current)
    if (index !== -1) return index
    const prefix = sliderPrefix(slider)
    if (prefix) {
      const near = nearestStepIndex(
        sliderLabels(slider),
        classToText(prefix, current, { allowNegative: sliderAllowNegative(slider) }),
      )
      if (near !== -1) return near
    }
  }
  const zero = sliderLabels(slider).indexOf('0')
  return zero === -1 ? 0 : zero
}

function sliderCustomPrefix(prop: StyleProperty): string | null {
  return sliderPrefix(control(prop, 'slider'))
}

function sliderValueText(prop: StyleProperty): string {
  const slider = control(prop, 'slider')
  const prefix = sliderPrefix(slider)
  if (!prefix) return ''
  if (slider.custom) return sizeClassToText(prefix, classFor(prop))
  return classToText(prefix, classFor(prop), { allowNegative: sliderAllowNegative(slider) })
}

function sliderValidate(prop: StyleProperty): ((text: string) => boolean) | undefined {
  const slider = control(prop, 'slider')
  if (!slider.custom) return undefined
  const { prefix, format } = slider.custom
  const known = sliderClasses(slider)
  return (text: string) => namedTextToClass(prefix, format, known, text) !== false
}

function applySliderText(prop: StyleProperty, text: string) {
  const slider = control(prop, 'slider')
  const prefix = sliderPrefix(slider)
  if (!prefix) return
  const cls = slider.custom
    ? namedTextToClass(prefix, slider.custom.format, sliderClasses(slider), text)
    : textToClass(prefix, text, { allowNegative: sliderAllowNegative(slider) })
  if (cls === false) return
  const current = classFor(prop)
  const next = tokens.value.filter((c) => c !== current)
  if (cls) next.push(cls)
  setTokens(next)
}

function setSlider(prop: StyleProperty, index: number) {
  const classes = sliderClasses(control(prop, 'slider'))
  set(prop, classes[index] ?? classes[0]!)
}

function sliderMax(prop: StyleProperty): number {
  return sliderClasses(control(prop, 'slider')).length - 1
}

function sliderReadout(prop: StyleProperty): string {
  return sliderLabels(control(prop, 'slider'))[sliderIndex(prop)] ?? ''
}

function colorValue(prop: StyleProperty): string {
  const cls = classFor(prop)
  if (!cls) return 'slate-500'
  const value = cls.slice(control(prop, 'color').prefix.length + 1)
  return value.match(/^\[(#[0-9a-fA-F]+)\]$/)?.[1] ?? value
}

function setColor(prop: StyleProperty, value: string) {
  const { prefix } = control(prop, 'color')
  set(prop, value.startsWith('#') ? `${prefix}-[${value}]` : `${prefix}-${value}`)
}

function colorText(prop: StyleProperty): string {
  const cls = classFor(prop)
  if (!cls) return ''
  const value = cls.slice(control(prop, 'color').prefix.length + 1)
  return value.match(/^\[(#[0-9a-fA-F]+)\]$/)?.[1] ?? value
}

const { validTokens } = useSettings()
const colorTokens = computed(() => validTokens.value.map((t) => ({ name: t.name, value: t.value })))

const COLOR_KEYWORDS = ['white', 'black', 'transparent', 'current', 'inherit']
function isColorValue(text: string): boolean {
  const t = text.trim()
  if (t === '') return true
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t)) return true
  return COLOR_KEYWORDS.includes(t) || isPaletteColor(t)
}

function applyColorText(prop: StyleProperty, text: string) {
  if (text === '') remove(prop)
  else setColor(prop, text)
}

function inputValue(prop: StyleProperty): string {
  const { prefix } = control(prop, 'input')
  const value = classFor(prop) ?? ''
  return value.startsWith(`${prefix}-`) ? value.slice(prefix.length + 1) : value
}

function setInput(prop: StyleProperty, raw: string) {
  const { prefix } = control(prop, 'input')
  set(prop, `${prefix}-${raw.trim() || 'auto'}`)
}

const { pendingFocus } = usePanel()
const classInput = ref<InstanceType<typeof ClassInput>>()

function consumeFocus() {
  if (pendingFocus.value !== 'style') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => classInput.value?.focus())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)
</script>

<template>
  <div class="flex flex-col">
    <div
      v-if="layerOptions.length"
      class="flex flex-col gap-1.5 border-b border-input p-3"
      data-style-layer
    >
      <p class="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Editing</p>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="choice in layerChoices"
          :key="choice.value"
          type="button"
          class="h-6 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
          :class="
            (layer ?? '') === choice.value
              ? 'bg-accent/30 font-medium text-foreground'
              : 'bg-input text-muted-foreground hover:text-foreground'
          "
          :aria-pressed="(layer ?? '') === choice.value"
          @click="pickLayer(choice.value)"
        >
          {{ choice.label }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5 p-3 border-b border-input">
      <p class="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Classes</p>
      <ClassInput
        ref="classInput"
        :tokens="tokens"
        :inherited="inheritedTokens"
        :removable-inherited="removableInherited"
        @commit="setTokens"
        @remove="removeToken"
      />
    </div>

    <GroupAccordion
      v-for="section in visibleSections"
      :key="section.id"
      v-model:open="openSections[section.id]"
    >
      <TitleAccordion>
        {{ section.label }}
      </TitleAccordion>

      <ContentAccordion>
        <SpacingControl
          v-if="section.id === 'spacing'"
          :key="styleTarget?.id"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <SizeControl
          v-else-if="section.id === 'size'"
          :key="`size-${styleTarget?.id}`"
          :model-value="tokens"
          @update:model-value="setTokens"
        />
        <template v-else>
        <div v-if="section.id === 'background'" class="relative mb-1.5 flex flex-col gap-1.5 px-2.5 pl-8">
          <div class="absolute left-1 top-0">
            <ButtonUI
              v-if="backgroundMedia !== backgroundBaseline"
              variant="ghost"
              size="xs"
              :icon="RotateCcw"
              tooltip="Revert"
              class="aspect-square shrink-0 text-muted-foreground"
              @click="backgroundMedia = backgroundBaseline"
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs leading-6 text-foreground">Media</span>
            <ButtonUI
              v-if="backgroundMedia"
              variant="ghost"
              size="xs"
              :icon="X"
              tooltip="Remove background"
              class="aspect-square text-muted-foreground"
              @click="backgroundMedia = ''"
            />
          </div>
          <MediaPickerControl
            :key="`bg-${styleTarget?.id}`"
            v-model="backgroundMedia"
            kind="image"
            :kinds="['image', 'video']"
          />
        </div>
        <SpacingBoxControl
          v-if="section.id === 'border'"
          :key="`bw-${styleTarget?.id}`"
          label="Width"
          base="border"
          :scheme="borderWidthScheme"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <template v-for="prop in visibleProps(section)" :key="prop.id">
        <AlignGridControl
          v-if="prop.id === 'align'"
          :key="`align-${styleTarget?.id}`"
          :model-value="tokens"
          :baseline="baseline"
          :vertical="isVerticalFlex"
          @update:model-value="setTokens"
        />
        <AlignGridControl
          v-else-if="prop.id === 'self'"
          :key="`self-${styleTarget?.id}`"
          mode="self"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <GapControl
          v-else-if="prop.id === 'gap'"
          :key="`gap-${styleTarget?.id}`"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <InsetControl
          v-else-if="prop.id === 'top'"
          :key="`inset-${styleTarget?.id}`"
          :model-value="tokens"
          @update:model-value="setTokens"
        />
        <RowUI v-else :label="prop.label">
          <BorderStyleControl
              v-if="prop.id === 'border-style'"
              :model-value="tokens"
              @update:model-value="setTokens"
            />
            <SelectUI
              v-else-if="prop.control.kind === 'select'"
              :options="selectOptions(prop)"
              placeholder="—"
              :model-value="classFor(prop) ?? ''"
              @update:model-value="(v) => v && set(prop, v)"
            />
            <template v-else-if="prop.control.kind === 'slider'">
              <SliderUI
                :min="0"
                :max="sliderMax(prop)"
                :model-value="sliderIndex(prop)"
                @update:model-value="(v) => setSlider(prop, v)"
              />
              <ValueFieldUI
                v-if="sliderCustomPrefix(prop)"
                :model-value="sliderValueText(prop)"
                :allow-negative="sliderAllowNegative(control(prop, 'slider'))"
                :validate="sliderValidate(prop)"
                @commit="(t) => applySliderText(prop, t)"
              />
              <span v-else class="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {{ sliderReadout(prop) }}
              </span>
            </template>
            <IconGroupUI
              v-else-if="prop.control.kind === 'icons'"
              :options="control(prop, 'icons').options.map((o) => ({ label: o.label, value: o.class, icon: STYLE_ICONS[o.icon]! }))"
              :model-value="classFor(prop) ?? undefined"
              @update:model-value="(v) => v && set(prop, v)"
            />
            <ColorFieldUI
              v-else-if="prop.control.kind === 'color'"
              :model-value="colorText(prop)"
              :tokens="colorTokens"
              :validate="isColorValue"
              :swatch="colorValue(prop)"
              placeholder="—"
              @commit="(t) => applyColorText(prop, t)"
              @pick="(v) => setColor(prop, v)"
            />
            <InputUI
              v-else-if="prop.control.kind === 'input'"
              :placeholder="control(prop, 'input').placeholder"
              :model-value="inputValue(prop)"
              @update:model-value="(v) => setInput(prop, v)"
            />

          <template #start>
            <ButtonUI
              v-if="isDirty(prop)"
              variant="ghost"
              size="xs"
              :icon="RotateCcw"
              tooltip="Revert"
              class="aspect-square shrink-0 text-muted-foreground"
              @click="revert(prop)"
            />
          </template>
        </RowUI>
        </template>
        </template>
      </ContentAccordion>
    </GroupAccordion>

  </div>
</template>
