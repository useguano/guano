<script setup lang="ts">
import { computed, inject } from 'vue'
import { Code2 } from 'lucide-vue-next'
import { useElement } from '@/composables/useElement'
import { useProject } from '@/composables/useProject'
import { resolveClassesForWidth } from '@/lib/responsive'
import { FRAME_BREAKPOINT } from '@/components/editor/canvas/frameScope'
import { declaresOwnBox } from '@/components/editor/canvas/emptyBox'
import { isLeafElement } from '@/lib/elements'
import { VARIANT_ACTIVE } from '@/components/editor/canvas/variantScope'
import { useStructure } from '@/composables/useStructure'
import EntryScope from '@/components/shared/EntryScope.vue'
import { useInteraction } from '@/composables/useInteraction'
import { useContextMenu } from '@/composables/useContextMenu'
import { useRenderNode } from '@/composables/useRenderNode'
import { useInlineEdit } from '@/composables/useInlineEdit'
import {
  perViewForWidth,
  sliderHostExtraClass,
  SLIDER_SLIDE_CLASSES,
  SLIDER_ARROW_CLASSES,
  SLIDER_PREV_CLASS,
  SLIDER_NEXT_CLASS,
  SLIDER_PREV_SVG,
  SLIDER_NEXT_SVG,
  SLIDER_DOTS_CLASSES,
  SLIDER_DOT_CLASSES,
  SLIDER_DOT_ACTIVE_CLASSES,
} from '@/lib/shared/slider.js'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const { selectElement, draggingId, dropTarget, isSelected, isHighlighted, dropPositionFor, requestReveal } = useElement()
const { backend } = useStructure()
const { pickingFor, pickTarget } = useInteraction()
const { openMenu } = useContextMenu()

const {
  def,
  mapping,
  listCollection,
  listEntries,
  listTemplateChildren,
  listEmptyChildren,
  isForm,
  formStateChildren,
  formFieldChildren,
  itemCollection,
  itemEntry,
  itemTemplateChildren,
  selfNested,
  customAttrs,
  backgroundInfo,
  contentInfo,
  displayContent,
  richContent,
  srcInfo,
  srcAttr,
  altAttr,
  iconInfo,
  hidden,
  editableText,
  richEditing,
  inlineInitialText,
  commitInlineText,
  baseClasses,
  hoverHandlers,
  fireClickInteractions,
  fireChangeInteractions,
  el,
  motionStyle,
  sliderBound,
  sliderResolved,
  sliderLabels,
  sliderTrackClass,
} = useRenderNode(() => props.node, { fieldPlaceholders: true })

const untranslated = computed(
  () =>
    (!props.node.children.length && contentInfo.value.untranslated) || srcInfo.value.untranslated,
)

const titleAttr = computed(() => (untranslated.value ? 'Not translated' : undefined))

const frameBreakpointId = inject(FRAME_BREAKPOINT, null)
const { breakpoints, activeBreakpointId, baseBreakpoint } = useProject()

const frameWidth = computed(
  () => breakpoints.value.find((b) => b.id === frameBreakpointId)?.width ?? null,
)
const framedClasses = computed(() => {
  const joined = baseClasses.value.filter(Boolean).join(' ')
  return frameWidth.value !== null ? resolveClassesForWidth(joined, frameWidth.value) : joined
})

const sliderHostClass = computed(() =>
  props.node.type === 'slider' ? sliderHostExtraClass(props.node.classes) : '',
)

const canvasDotCount = computed(() => {
  if (props.node.type !== 'slider') return 0
  const slides = sliderBound.value
    ? Math.max(1, listEntries.value.length)
    : props.node.children.length
  const perView = perViewForWidth(
    props.node.slider,
    breakpoints.value,
    frameWidth.value ?? baseBreakpoint.value?.width ?? Number.POSITIVE_INFINITY,
  )
  const count = slides - perView + 1
  return count > 1 ? count : 0
})
const variantActive = inject(VARIANT_ACTIVE, null)
const inActiveFrame = computed(() => {
  if (variantActive && !variantActive.value) return false
  if (frameBreakpointId === null) return true
  return frameBreakpointId === (activeBreakpointId.value ?? baseBreakpoint.value?.id ?? null)
})

const selected = computed(() => inActiveFrame.value && isSelected(props.node.id, true))
const highlighted = computed(
  () => inActiveFrame.value && isHighlighted(props.node.id) && !selected.value,
)
const dropPosition = computed(() => dropPositionFor(props.node.id))

const OWN_CANVAS_SHAPE = ['body', 'collection-list', 'collection-item', 'slider', 'custom-code']

const emptyBox = computed(() => {
  if (!def.value || isLeafElement(props.node.type)) return false
  if (OWN_CANVAS_SHAPE.includes(props.node.type)) return false
  if (props.node.children.length || displayContent.value?.trim()) return false
  return !declaresOwnBox(framedClasses.value)
})

const classes = computed(() => [
  framedClasses.value,
  emptyBox.value && 'min-h-10 outline-dashed outline-1 -outline-offset-1 outline-input',
  !def.value?.void &&
    !props.node.children.length &&
    !['body', 'collection-list', 'collection-item', 'slider'].includes(props.node.type) &&
    'select-text',
  untranslated.value && 'opacity-60',
  selected.value && !editing.value && 'outline-solid! outline-2! -outline-offset-2! outline-sky-500!',
  highlighted.value && !editing.value && 'outline-solid! outline-2! -outline-offset-2! outline-emerald-500!',
  dropPosition.value &&
    (dropPosition.value === 'before'
      ? 'shadow-[0_-2px_0_0_#0ea5e9]'
      : dropPosition.value === 'after'
        ? 'shadow-[0_2px_0_0_#0ea5e9]'
        :
          'outline-dashed! outline-2! -outline-offset-2! outline-sky-500! bg-sky-500/5'),
])

const { editing, editEl, startEditing, finishEditing, onEditKeydown } = useInlineEdit({
  editable: editableText,
  rich: richEditing,
  initialText: inlineInitialText,
  commit: commitInlineText,
  onExit: () => requestReveal(),
})

const FOCUSING_TAGS = new Set(['input', 'select', 'textarea'])
const tag = computed(() => def.value?.tag ?? 'div')

function stateBlockVisible(child: ElementNode): boolean {
  const hit = (n: ElementNode): boolean =>
    isSelected(n.id) || (n.children ?? []).some(hit)
  return hit(child)
}

const handlers = {
  dblclick: startEditing,
  submit(e: Event) {
    e.preventDefault()
  },
  mousedown(e: MouseEvent) {
    if (editing.value) return
    if (FOCUSING_TAGS.has(tag.value)) e.preventDefault()
  },
  click(e: Event) {
    e.stopPropagation()
    if (editing.value) return
    e.preventDefault()
    if (pickingFor.value) {
      pickTarget(mapping.value ? mapping.value.master.id : props.node.id)
      return
    }
    fireClickInteractions()
    selectElement(props.node.id)
    requestReveal()
  },
  contextmenu(e: MouseEvent) {
    e.stopPropagation()
    openMenu(e, props.node.id)
  },
  ...hoverHandlers,
  change: fireChangeInteractions,
  input: fireChangeInteractions,
  dragstart(e: DragEvent) {
    if (props.node.type === 'body') return
    if (!backend.value.can(props.node, 'move')) return
    e.stopPropagation()
    draggingId.value = props.node.id
    e.dataTransfer?.setData('text/plain', props.node.id)
  },
  dragover(e: DragEvent) {
    if (!draggingId.value || draggingId.value === props.node.id) return
    if (props.node.type === 'body') return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropTarget.value = {
      id: props.node.id,
      position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
    }
  },
  drop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (
      draggingId.value &&
      dropTarget.value?.id === props.node.id &&
      dropTarget.value.position !== 'inside'
    ) {
      backend.value.move([draggingId.value], props.node.id, dropTarget.value.position)
    }
    draggingId.value = null
    dropTarget.value = null
  },
  dragend() {
    draggingId.value = null
    dropTarget.value = null
  },
}
</script>

<template>
  <template v-if="hidden" />
  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'collection-list'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  >
    <template v-if="listCollection">
      <template v-if="listEntries.length">
        <EntryScope
          v-for="(entry, i) in listEntries"
          :key="entry.id"
          :collection="listCollection"
          :entry="entry"
          :index="i"
          :count="listEntries.length"
        >
          <ElementRenderer
            v-for="child in listTemplateChildren"
            :key="`${child.id}:${entry.id}`"
            :node="child"
          />
        </EntryScope>
      </template>

      <template v-else>
        <EntryScope :collection="listCollection" :entry="null">
          <ElementRenderer
            v-for="child in listTemplateChildren"
            :key="child.id"
            :node="child"
          />
        </EntryScope>
        <ElementRenderer v-for="child in listEmptyChildren" :key="child.id" :node="child" />
      </template>
    </template>
    <div v-else class="border border-dashed border-input p-2 text-xs text-muted-foreground">
      Unknown collection ({{ node.arg || '?' }})
    </div>
  </component>

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'slider'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="[classes, sliderHostClass]"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  >
    <div data-sl-track :class="sliderTrackClass">
      <template v-if="sliderBound && listCollection">
        <div
          v-for="(entry, i) in listEntries"
          :key="entry.id"
          data-sl-slide
          :class="SLIDER_SLIDE_CLASSES"
        >
          <EntryScope
            :collection="listCollection"
            :entry="entry"
            :index="i"
            :count="listEntries.length"
          >
            <ElementRenderer
              v-for="child in node.children"
              :key="`${child.id}:${entry.id}`"
              :node="child"
            />
          </EntryScope>
        </div>
        <div v-if="!listEntries.length" data-sl-slide :class="SLIDER_SLIDE_CLASSES">
          <EntryScope :collection="listCollection" :entry="null">
            <ElementRenderer v-for="child in node.children" :key="child.id" :node="child" />
          </EntryScope>
        </div>
      </template>

      <div
        v-else-if="node.arg"
        data-sl-slide
        :class="[SLIDER_SLIDE_CLASSES, 'border border-dashed border-input p-2 text-xs text-muted-foreground']"
      >
        Unknown collection ({{ node.arg }})
      </div>
      <template v-else>
        <div
          v-for="child in node.children"
          :key="child.id"
          data-sl-slide
          :class="SLIDER_SLIDE_CLASSES"
        >
          <ElementRenderer :node="child" />
        </div>
      </template>
    </div>
    <template v-if="sliderResolved.arrows">
      <button
        type="button"
        data-sl-prev
        tabindex="-1"
        :aria-label="sliderLabels.prev"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_PREV_CLASS]"
        v-html="SLIDER_PREV_SVG"
      />
      <button
        type="button"
        data-sl-next
        tabindex="-1"
        :aria-label="sliderLabels.next"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_NEXT_CLASS]"
        v-html="SLIDER_NEXT_SVG"
      />
    </template>
    <div
      v-if="sliderResolved.dots"
      data-sl-dots
      :aria-label="sliderLabels.dots"
      :class="SLIDER_DOTS_CLASSES"
    >
      <span
        v-for="i in canvasDotCount"
        :key="i"
        :class="i === 1 ? SLIDER_DOT_ACTIVE_CLASSES : SLIDER_DOT_CLASSES"
      />
    </div>
  </component>

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'collection-item'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  >
    <template v-if="itemCollection && !selfNested">
      <EntryScope :collection="itemCollection" :entry="itemEntry">
        <ElementRenderer v-for="child in itemTemplateChildren" :key="child.id" :node="child" />
      </EntryScope>
    </template>
    <div v-else class="border border-dashed border-input p-2 text-xs text-muted-foreground">
      {{ selfNested ? 'A template can’t embed its own collection' : `Unknown collection (${node.arg || '?'})` }}
    </div>
  </component>

  <component
    :is="def?.tag ?? 'form'"
    v-else-if="isForm"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="[backgroundInfo?.style, motionStyle]"
    draggable="true"
    v-on="handlers"
  >
    <ElementRenderer v-for="child in formFieldChildren" :key="child.id" :node="child" />
    <template v-for="child in formStateChildren" :key="child.id">
      <ElementRenderer v-if="stateBlockVisible(child)" :node="child" />
    </template>
  </component>

  <svg
    v-else-if="iconInfo"
    ref="el"
    v-bind="{ ...iconInfo.attrs, ...customAttrs }"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
    v-html="iconInfo.inner"
  />

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'custom-code'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="[classes, 'flex min-h-10 items-center gap-2 border border-dashed border-current/30 px-3 py-2 text-xs opacity-60']"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  >
    <Code2 class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="truncate font-mono">{{ displayContent?.trim() ? displayContent.trim().split('\n')[0] : 'Custom code' }}</span>
  </component>
  <component
    :is="def?.tag ?? 'div'"
    v-else-if="def?.void"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :title="titleAttr"
    :src="srcAttr"
    :alt="altAttr"
    :class="classes"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  />
  <component
    :is="def?.tag ?? 'div'"
    v-else
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :title="titleAttr"
    :src="srcAttr"
    :alt="altAttr"
    :class="[
      classes,
      editing && 'cursor-text outline-solid! outline-2! -outline-offset-2! outline-accent! bg-accent/5',
    ]"
    :style="[backgroundInfo?.style, motionStyle]"
    :draggable="!editing"
    v-on="handlers"
  >
    <video
      v-if="backgroundInfo?.kind === 'video'"
      :src="backgroundInfo.url"
      autoplay
      muted
      loop
      playsinline
      :class="backgroundInfo.layerClass"
    />
    <template v-if="!node.children.length && !editing">
      <span v-if="richContent !== null" v-html="richContent"></span>
      <template v-else>{{ displayContent }}</template>
    </template>
    <span
      v-if="editing"
      ref="editEl"
      :contenteditable="richEditing ? 'true' : 'plaintext-only'"
      class="outline-none"
      @blur="finishEditing(false)"
      @keydown="onEditKeydown"
    ></span>
    <ElementRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
</template>
