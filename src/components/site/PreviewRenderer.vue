<script lang="ts">
// One pending link navigation for the whole tree: while content editing is on,
// a single click schedules it and ANY double-click cancels it (clicks bubble —
// a dblclick on an image inside a link must cancel the link's timer, and
// stopPropagation on the child's dblclick would otherwise hide it from the
// parent).
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
// Preview-mode renderer: the site rendered like a live preview, navigable by
// clicking links (state-driven — switches the active page/entry, no URL
// change). Built on the shared rendering core (useRenderNode).
//
// For an admin or editor Play is READ-ONLY: the site the way a visitor gets
// it, with interactions, animations, sliders and links running for real, and
// content edited on the Edit surface. A CONTRIBUTOR is pinned to Play, so for
// them it is also where content is edited (`usePreviewEditing`): double-click
// text to edit it in place, double-click an image/video to replace it, and
// right-click for "Edit content" / "Replace background". Only content — the
// server's contributor merge drops anything else.
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
} = useRenderNode(() => props.node)

// --- forms in Play ---
//
// Play runs the site for real, with one deliberate exception: a submission is
// NOT sent. Play is an editor surface, and a test submission landing in the
// real inbox (or a real lead list) would be a surprise nobody asked for. So a
// submit validates natively, shows the success block and says plainly that
// nothing was sent.
//
// Before this, a form in Play had no submit handling at all: it posted to the
// SPA's own URL and reloaded the editor, losing whatever was unsaved.
const submitted = ref(false)

const classes = computed(() => [baseClasses.value])

// --- slider: the published runtime, running live in Preview ---

const sliderHostClass = computed(() =>
  props.node.type === 'slider' ? sliderHostExtraClass(props.node.classes) : '',
)

let destroySlider: (() => void) | null = null
// two runs of the watcher can straddle the `await` below (the template ref
// lands mid-flush, re-queueing it). Without a generation token the second run
// would find `destroySlider` still null, destroy nothing, and leave the first
// instance alive forever — its autoplay interval would keep advancing the
// track at double rate, even after the node unmounts.
let sliderGeneration = 0

if (props.node.type === 'slider') {
  watch(
    // re-init when the element mounts, when anything the runtime MEASURES
    // changes (the track classes carry gap and slides-per-view), or when the
    // number of slides does. `listEntries` itself is a fresh array on every
    // recompute, so only its length is a source — otherwise editing any entry
    // in Preview would tear down every slider on the page.
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
      // a newer run started while we awaited — it owns the instance now
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

// --- links (state-driven navigation) ---

// '@item' resolution + scheme allowlist live in the render core
const linkTarget = computed(() => {
  const raw = linkRaw.value
  return raw ? { raw, internal: raw.startsWith('/') } : null
})

// --- content editing (contributors only — see usePreviewEditing) ---
// what's editable, what it opens with and where it commits all come from the
// render core; Play differs from the Edit canvas only in Esc committing

const textEditable = computed(() => contentEditing.value && editableText.value)
const isMedia = computed(
  () => contentEditing.value && (props.node.type === 'image' || props.node.type === 'video'),
)
// A background inside a component instance is the MASTER's (backgroundInfo
// renders from it, like style), and the contributor merge keeps masters from
// the stored copy — offering it would be a write that silently goes nowhere.
// Text leaves (a heading, a paragraph) don't offer one either: their menu is
// about their words, and a background is a section's or a card's.
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
  // a collection-bound image writes the entry field; a plain image its src
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

/** the edit action for this node's content */
function edit(e?: Event) {
  if (textEditable.value) startEditing(e)
  else if (isMedia.value) void pickMedia()
}

const contentEditable = computed(() => textEditable.value || isMedia.value)

// a context-menu item targets a node by id — claim it here
watch(editRequest, () => {
  const kind: PreviewEditKind | null = consumeEditRequest(props.node.id)
  if (kind === 'content') edit()
  else if (kind === 'background') void pickBackground()
})

// The affordance Play owes a visitor is the one the published site gives: a
// pointer over something a click follows (any element can carry a link, not
// just an <a>, so the cursor is ours to set). A contributor also gets a soft
// outline over what double-click can edit, suppressed while editing so it
// can't fight the solid ring. Cursor precedence: linked → pointer (click
// navigates), editable text → text cursor, media → pointer.
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
    activeEntryId.value = null // leaving any loaded entry
    setActivePage(resolved.page.id)
  }
}

/** navigate with the site's page transition around it, when one is configured.
 * `enter` runs synchronously after the switch — the new tree hasn't rendered
 * yet, so its first frame is in place before it paints. */
async function followLink(raw: string) {
  await pageTransition.leave()
  navigate(raw)
  pageTransition.enter()
}

const handlers = {
  submit(e: Event) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    // the browser's own validation still runs, so a required field or a bad
    // email reads exactly as it will on the site
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return
    submitted.value = true
  },
  click(e: MouseEvent) {
    if (editing.value) return
    fireClickInteractions()
    if (!linkTarget.value?.internal) return
    e.preventDefault()
    const raw = linkTarget.value.raw
    // nothing to edit → follow at once. Otherwise a dblclick always fires a
    // click first, so navigation waits one beat and any double-click cancels
    // it (shared timer: see the module script above)
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
    // the nearest element that can do anything claims the menu. A background
    // is offered only when the right-click lands on the element's OWN surface
    // (a section's empty space) — otherwise a click on an instance's header,
    // which offers nothing, would bubble up and offer the page's background
    const background = backgroundEditable.value && e.target === el.value
    if (!contentEditable.value && !background) return
    openMenu(e, props.node.id, { content: contentEditable.value, background })
  },
  ...hoverHandlers,
  // both events, mirroring the published runtime: 'input' makes text fields
  // update live rather than only on blur (server/site-runtime.js)
  change: fireChangeInteractions,
  input: fireChangeInteractions,
}
</script>

<template>
  <!-- a hidden node renders nothing; it lives on in the Layers tree -->
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
    <!-- nothing to repeat: the empty-state block, if the author wrote one -->
    <PreviewRenderer
      v-else-if="listCollection"
      v-for="child in listEmptyChildren"
      :key="child.id"
      :node="child"
    />
  </component>

  <!-- carousel — the same DOM the published site gets, driven by the same
       initSlider from shared/slider.js, so Preview and the live site match -->
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
    <!-- the runtime fills the dot rail, so it knows the real reachable count -->
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

  <!-- a form: real native validation, and the success block on submit — but
       nothing is sent from an editor surface (see `submitted` above) -->
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

  <!-- an icon: the <svg> is the element itself (see ElementRenderer) -->
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
  <!-- raw HTML is not rendered on Play either: the same placeholder as the
       canvas, so a reviewer sees where the embed sits -->
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
