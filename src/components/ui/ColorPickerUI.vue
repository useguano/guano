<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { TAILWIND_COLORS, TAILWIND_SHADES, colorHex, parseColorInput } from '@/lib/colors'
import { computeFloatingPosition } from '@/lib/floating'

/** model is a color value: 'slate-100', 'white', 'transparent', or '#hex' */
const model = defineModel<string>({ default: 'slate-500' })

const props = withDefaults(
  defineProps<{
    /** 'sm' is the compact swatch embedded inside a value field; the default
     * matches the h-7 inputs it sits beside */
    size?: 'default' | 'sm'
    /** which edge of the trigger the palette aligns to */
    align?: 'left' | 'right'
    /** 'hex' resolves every pick to a hex value — for design tokens, whose
     * value compiles into a CSS variable and can't be a palette NAME */
    output?: 'value' | 'hex'
  }>(),
  { size: 'default', align: 'right', output: 'value' },
)

const hex = computed(() => colorHex(model.value))

// The palette is teleported to <body> and positioned fixed from the trigger's
// rect: inline, it was clipped by any overflow-hidden ancestor (the settings
// modal, the sidebar panel). A click on it therefore isn't inside `root`, so
// outside-click checks both elements rather than going through useDropdown.
const open = ref(false)
const root = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const pos = ref({ left: 0, top: 0 })

async function place() {
  await nextTick()
  if (!root.value || !panel.value) return
  const anchor = root.value.getBoundingClientRect()
  const { width, height } = panel.value.getBoundingClientRect()
  const p = computeFloatingPosition(anchor, { width, height }, {
    placement: props.align === 'left' ? 'bottom-start' : 'bottom-end',
    offset: 4,
  })
  pos.value = { left: p.left, top: p.top }
}

function toggle() {
  open.value = !open.value
  if (open.value) {
    typed.value = model.value
    place()
  }
}
function close() {
  open.value = false
}

function pick(value: string) {
  // a token value compiles into a CSS variable, so it must be hex — including
  // transparent, which colorHex keeps as a keyword for class use
  model.value =
    props.output === 'hex' ? (value === 'transparent' ? '#00000000' : colorHex(value)) : value
  close()
}

// free entry: a hex, rgb()/hsl(), a CSS colour name, a palette shade or a
// token name. Enter commits; what the browser can't read shakes the field red.
const typed = ref('')
const typedInvalid = ref(false)
function commitTyped() {
  const parsed = parseColorInput(typed.value)
  if (!parsed) {
    typedInvalid.value = true
    setTimeout(() => (typedInvalid.value = false), 600)
    return
  }
  pick(parsed)
}

function onClickOutside(e: MouseEvent) {
  const t = e.target as Node
  if (root.value?.contains(t) || panel.value?.contains(t)) return
  close()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    close()
  }
}
onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <!-- flex, not block: an inline button in a block wrapper gains descender space
       below it, which pushed the swatch up against its neighbours -->
  <div ref="root" class="relative flex shrink-0 items-center">
    <button
      v-tooltip="model"
      type="button"
      class="shrink-0 cursor-pointer border border-input outline-none focus-visible:ring-2 focus-visible:ring-accent"
      :class="size === 'sm' ? 'size-5 rounded-md' : 'size-7 rounded-lg'"
      :style="{ backgroundColor: hex }"
      @click="toggle"
      @keydown="onKeydown"
    />

    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="fixed z-105 rounded-xl border border-input bg-background p-2 shadow-md"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
        @keydown="onKeydown"
      >
        <!-- the whole palette, no inner scroller: 19 rows of 11 swatches -->
        <div class="flex flex-col gap-0.5">
          <div v-for="(hexes, name) in TAILWIND_COLORS" :key="name" class="flex gap-0.5">
            <button
              v-for="(swatch, i) in hexes"
              :key="swatch"
              v-tooltip="`${name}-${TAILWIND_SHADES[i]}`"
              type="button"
              class="size-4 shrink-0 cursor-pointer rounded-sm hover:scale-125"
              :style="{ backgroundColor: swatch }"
              @click="pick(`${name}-${TAILWIND_SHADES[i]}`)"
            />
          </div>
        </div>

        <div class="mt-2 flex items-center gap-1.5">
          <button
            v-tooltip="'white'"
            type="button"
            class="size-4 cursor-pointer rounded-sm border border-input bg-white"
            @click="pick('white')"
          />
          <button
            v-tooltip="'black'"
            type="button"
            class="size-4 cursor-pointer rounded-sm border border-input bg-black"
            @click="pick('black')"
          />
          <input
            v-model="typed"
            type="text"
            spellcheck="false"
            placeholder="#hex, rgba(), name…"
            class="ml-auto h-6 w-32 rounded-md bg-input px-1.5 font-mono text-[10px] outline-none placeholder:text-muted-foreground focus-visible:ring-2"
            :class="typedInvalid ? 'ring-2 ring-danger' : 'focus-visible:ring-accent'"
            @keydown.enter.prevent="commitTyped"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>
