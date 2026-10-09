<script lang="ts">
const NAV_DELAY_MS = 250
let pendingNav: number | null = null
function cancelPendingNav() {
  if (pendingNav !== null) {
    clearTimeout(pendingNav)
    pendingNav = null
  }
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Code2 } from 'lucide-vue-next'
import EntryScope from '@/components/shared/EntryScope.vue'
import { useLocale } from '@/composables/useLocale'
import { useRenderNode } from '@/composables/useRenderNode'
import { useInlineEdit } from '@/composables/useInlineEdit'
import { usePreviewEditing, type PreviewEditKind } from '@/composables/usePreviewEditing'
import { useMedia } from '@/composables/useMedia'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useProject } from '@/composables/useProject'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { usePageTransition } from '@/composables/usePageTransition'
import { resolveSitePath } from '@/lib/navigation'
import { reducedMotion } from '@/lib/motion'
import {
  initSlider,
  sliderHostExtraClass,
  SLIDER_SLIDE_CLASSES,
  SLIDER_ARROW_CLASSES,
  SLIDER_PREV_CLASS,
  SLIDER_NEXT_CLASS,
  SLIDER_PREV_SVG,
  SLIDER_NEXT_SVG,
  SLIDER_DOTS_CLASSES,
} from '@/lib/shared/slider.js'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const { project } = useProject()
const { setActivePage } = usePage()
const { openEntry, activeEntryId } = useCollections()
const { setActiveLocale, setNodeSrc, setEntryValue } = useLocale()
const { contentEditing, openMenu, editRequest, consumeEditRequest } = usePreviewEditing()
const pageTransition = usePageTransition()

const {
  def, mapping, boundField, boundEntry,
  listCollection, listEntries, listTemplateChildren, listEmptyChildren, itemCollection, itemEntry, itemTemplateChildren, selfNested,
  customAttrs, backgroundInfo, sliderLabels,
  displayContent, richContent, srcAttr, altAttr, iconInfo, hidden, linkRaw, baseClasses,
  editableText, richEditing, inlineInitialText, commitInlineText,
  hoverHandlers, fireClickInteractions, fireChangeInteractions, el,
  motionStyle,
  sliderBound, sliderResolved, sliderTrackClass, sliderWire,
  isForm, formStateChildren, formFieldChildren,
} = useRenderNode(() => props.node, { restingMotion: true })

const submitted = ref(false)

const classes = computed(() => [baseClasses.value])

const sliderHostClass = computed(() =>
  props.node.type === 'slider' ? sliderHostExtraClass(props.node.classes) : '',
)

let destroySlider: (() => void) | null = null
let sliderGeneration = 0

if (props.node.type === 'slider') {
  watch(
    [
      el,
      () => JSON.stringify(sliderWire.value),
      sliderTrackClass,
      () => (sliderBound.value ? listEntries.value.length : props.node.children.length),
    ],
    async () => {
      const generation = ++sliderGeneration
      destroySlider?.()
      destroySlider = null
      await nextTick()
      if (generation !== sliderGeneration) return
      const host = el.value
      if (!host) return
      destroySlider = initSlider(host, sliderWire.value, { still: reducedMotion() })
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    sliderGeneration++
    destroySlider?.()
    destroySlider = null
  })
}

const linkTarget = computed(() => {
  const raw = linkRaw.value
  return raw ? { raw, internal: raw.startsWith('/') } : null
})

const textEditable = computed(() => contentEditing.value && editableText.value)
const isMedia = computed(
  () => contentEditing.value && (props.node.type === 'image' || props.node.type === 'video'),
)
const backgroundEditable = computed(
  () =>
    contentEditing.value &&
    !mapping.value &&
    !def.value?.void &&
    !iconInfo.value &&
    def.value?.defaultContent === undefined,
)

const { editing, editEl, startEditing, finishEditing, onEditKeydown } = useInlineEdit({
  editable: textEditable,
  rich: richEditing,
  initialText: inlineInitialText,
  commit: commitInlineText,
  escBehavior: 'save',
})

async function pickMedia() {
  const picked = await useMediaLibrary().openSelect([
    props.node.type === 'video' ? 'video' : 'image',
  ])
  if (!picked) return
  const url = useMedia().mediaUrl(picked)
  if (boundField.value?.type === 'image' && boundEntry.value) {
    setEntryValue(boundEntry.value, boundField.value.name, url)
  } else {
    setNodeSrc(props.node, url)
  }
}

async function pickBackground() {
  const picked = await useMediaLibrary().openSelect(['image', 'video'])
  if (!picked) return
  props.node.background = useMedia().mediaUrl(picked)
}

function edit(e?: Event) {
  if (textEditable.value) startEditing(e)
  else if (isMedia.value) void pickMedia()
}

const contentEditable = computed(() => textEditable.value || isMedia.value)

watch(editRequest, () => {
  const kind: PreviewEditKind | null = consumeEditRequest(props.node.id)
  if (kind === 'content') edit()
  else if (kind === 'background') void pickBackground()
})

const hoverAffordance = computed(() => {
  if (editing.value) return null
  if (contentEditable.value) {
    return [
      'hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-accent/40',
      linkTarget.value || !textEditable.value ? 'cursor-pointer' : 'cursor-text',
    ]
  }
  return linkTarget.value ? 'cursor-pointer' : null
})

function navigate(raw: string) {
  const resolved = resolveSitePath(project.value, raw)
  if (resolved.kind === 'notfound') return
  setActiveLocale(resolved.locale)
  if (resolved.kind === 'entry') {
    openEntry(resolved.collection, resolved.entry.id)
  } else {
    activeEntryId.value = null
    setActivePage(resolved.page.id)
  }
}

async function followLink(raw: string) {
  await pageTransition.leave()
  navigate(raw)
  pageTransition.enter()
}

const handlers = {
  submit(e: Event) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return
    submitted.value = true
  },
  click(e: MouseEvent) {
    if (editing.value) return
    fireClickInteractions()
    if (!linkTarget.value?.internal) return
    e.preventDefault()
    const raw = linkTarget.value.raw
    if (!contentEditing.value) {
      void followLink(raw)
      return
    }
    cancelPendingNav()
    pendingNav = window.setTimeout(() => {
      pendingNav = null
      void followLink(raw)
    }, NAV_DELAY_MS)
  },
  dblclick(e: MouseEvent) {
    cancelPendingNav()
    if (!contentEditable.value || editing.value) return
    e.preventDefault()
    e.stopPropagation()
    edit(e)
  },
  contextmenu(e: MouseEvent) {
    const background = backgroundEditable.value && e.target === el.value
    if (!contentEditable.value && !background) return
    openMenu(e, props.node.id, { content: contentEditable.value, background })
  },
  ...hoverHandlers,
  change: fireChangeInteractions,
  input: fireChangeInteractions,
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
    v-on="handlers"
  >
    <template v-if="listCollection && listEntries.length">
      <EntryScope
        v-for="(entry, i) in listEntries"
        :key="entry.id"
        :collection="listCollection"
        :entry="entry"
        :index="i"
        :count="listEntries.length"
      >
        <PreviewRenderer
          v-for="child in listTemplateChildren"
          :key="`${child.id}:${entry.id}`"
          :node="child"
        />
      </EntryScope>
    </template>
    <PreviewRenderer
      v-else-if="listCollection"
      v-for="child in listEmptyChildren"
      :key="child.id"
      :node="child"
    />
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
            <PreviewRenderer
              v-for="child in node.children"
              :key="`${child.id}:${entry.id}`"
              :node="child"
            />
          </EntryScope>
        </div>
      </template>
      <template v-else-if="!node.arg">
        <div
          v-for="child in node.children"
          :key="child.id"
          data-sl-slide
          :class="SLIDER_SLIDE_CLASSES"
        >
          <PreviewRenderer :node="child" />
        </div>
      </template>
    </div>
    <template v-if="sliderResolved.arrows">
      <button
        type="button"
        data-sl-prev
        :aria-label="sliderLabels.prev"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_PREV_CLASS]"
        v-html="SLIDER_PREV_SVG"
      />
      <button
        type="button"
        data-sl-next
        :aria-label="sliderLabels.next"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_NEXT_CLASS]"
        v-html="SLIDER_NEXT_SVG"
      />
    </template>
    <div
      v-if="sliderResolved.dots"
      data-sl-dots
      role="tablist"
      :aria-label="sliderLabels.dots"
      :class="SLIDER_DOTS_CLASSES"
    />
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
    v-on="handlers"
  >
    <template v-if="itemCollection && itemEntry && !selfNested">
      <EntryScope :collection="itemCollection" :entry="itemEntry">
        <PreviewRenderer v-for="child in itemTemplateChildren" :key="child.id" :node="child" />
      </EntryScope>
    </template>
  </component>

  <component
    :is="def?.tag ?? 'form'"
    v-else-if="isForm"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="[classes, hoverAffordance]"
    :style="[backgroundInfo?.style, motionStyle]"
    v-on="handlers"
  >
    <template v-if="!submitted">
      <PreviewRenderer v-for="child in formFieldChildren" :key="child.id" :node="child" />
    </template>
    <template v-else>
      <template v-for="child in formStateChildren" :key="child.id">
        <PreviewRenderer v-if="child.type === 'form-success'" :node="child" />
      </template>
      <p class="mt-2 text-xs opacity-60">Not sent — this is a preview.</p>
    </template>
  </component>

  <svg
    v-else-if="iconInfo"
    ref="el"
    v-bind="{ ...iconInfo.attrs, ...customAttrs }"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="[classes, hoverAffordance]"
    :style="motionStyle"
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
    :class="[classes, hoverAffordance, 'flex min-h-10 items-center gap-2 border border-dashed border-current/30 px-3 py-2 text-xs opacity-60']"
    :style="motionStyle"
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
    :src="srcAttr"
    :alt="altAttr"
    :class="[classes, hoverAffordance]"
    :style="motionStyle"
    v-on="handlers"
  />
  <component
    :is="def?.tag ?? 'div'"
    v-else
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :src="srcAttr"
    :alt="altAttr"
    :class="[
      classes,
      hoverAffordance,
      editing && 'cursor-text outline outline-2 -outline-offset-2 outline-accent bg-accent/5',
    ]"
    :style="[backgroundInfo?.style, motionStyle]"
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
    <PreviewRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
</template>
