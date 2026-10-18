<script lang="ts">
import { ref } from 'vue'
import type { BriefAnswers } from '@/lib/agentBrief'

/** a reference screenshot, as the composer's `agent-send` carries it */
export interface BriefImage {
  mediaType: string
  data: string
  url: string
}

/**
 * The draft, at MODULE scope — not in `<script setup>`, whose consts are
 * per-instance and so forgot fourteen screens the moment Escape unmounted the
 * stepper. It is kept until the drawer itself goes, so a mis-key or a glance at
 * the canvas costs nothing.
 */
const answers = ref<BriefAnswers>({})
const references = ref<(BriefImage & { name: string })[]>([])
const refUrls = ref<string[]>([])
const logo = ref<{ name: string; path: string } | null>(null)
const step = ref(0)
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, Sparkles, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ColorPickerUI from '@/components/ui/ColorPickerUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import { useLocale } from '@/composables/useLocale'
import { useMedia } from '@/composables/useMedia'
import { useNotice } from '@/composables/useNotice'
import { useSettings } from '@/composables/useSettings'
import {
  BRIEF_FONTS,
  BRIEF_GOALS,
  BRIEF_GRIDS,
  BRIEF_IMAGERY,
  BRIEF_MOTIONS,
  BRIEF_PAGES,
  BRIEF_PALETTES,
  BRIEF_SHAPES,
  BRIEF_TONES,
  compileBrief,
  type BriefStop,
} from '@/lib/agentBrief'

const emit = defineEmits<{ close: []; send: [text: string, images: BriefImage[]] }>()

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_REFERENCES = 3

const logoInput = ref<HTMLInputElement>()
const refInput = ref<HTMLInputElement>()

const { settings } = useSettings()
const { locales, addLocale, setDefaultLocale } = useLocale()
const { upload, mediaUrl } = useMedia()
const { notify } = useNotice()

/**
 * Fourteen screens, in the intake's order: what the model cannot invent first,
 * taste after. The titles are the only copy the person reads, so they are
 * questions rather than field labels.
 */
const SCREENS = [
  'What is it, and who is it for?',
  'What should a visitor do?',
  'Pages or sections',
  'Palette',
  'Light or dark?',
  'Shape',
  'Grid',
  'Motion',
  'Tone & type',
  'Imagery',
  'Languages',
  'Logo & brand',
  'References',
  'Anything I must use, or must not invent',
] as const

const COLOR_MODES = [
  { value: 'light', label: 'light' },
  { value: 'dark', label: 'dark' },
  { value: 'system', label: 'both (system)' },
] as const

const FONT_DIRECTIONS = BRIEF_FONTS.map((f) => f.name)

const last = computed(() => step.value === SCREENS.length - 1)

/** Screen 1 is the only required one — Build it is dead until it is answered. */
const canBuild = computed(() => !!(answers.value.subject ?? '').trim())

const busy = ref(false)

function toggle(key: 'pages' | 'tone' | 'imagery', value: string) {
  const current = answers.value[key] ?? []
  answers.value = {
    ...answers.value,
    [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
  }
}

const picked = (key: 'pages' | 'tone' | 'imagery', value: string) =>
  (answers.value[key] ?? []).includes(value)

function setStop(key: 'shape' | 'grid' | 'motion', value: number) {
  answers.value = { ...answers.value, [key]: value as BriefStop }
}

const stopOf = (key: 'shape' | 'grid' | 'motion') => answers.value[key] ?? 1

function back() {
  if (step.value > 0) step.value--
}

function next() {
  if (!last.value) step.value++
}

/** Skip is Next with nothing recorded — and it is on every screen but the first. */
const skip = next

function readImage(file: File): Promise<BriefImage & { name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`could not read ${file.name}`))
    reader.onload = () => {
      const url = String(reader.result)
      resolve({ name: file.name, mediaType: file.type, data: url.slice(url.indexOf(',') + 1), url })
    }
    reader.readAsDataURL(file)
  })
}

function tooBig(file: File): boolean {
  if (file.size <= MAX_IMAGE_BYTES) return false
  notify({
    kind: 'warning',
    title: `${file.name} is too large`,
    detail: 'Images up to 5 MB can be attached.',
    key: 'brief-attach',
  })
  return true
}

async function onLogo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || tooBig(file)) return
  try {
    const asset = await upload(file)
    logo.value = { name: file.name, path: mediaUrl(asset) }
  } catch (err) {
    notify({
      kind: 'error',
      title: 'Could not upload the logo',
      detail: err instanceof Error ? err.message : undefined,
      key: 'brief-logo',
    })
  }
}

async function onReferences(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  ;(e.target as HTMLInputElement).value = ''
  for (const file of files) {
    if (references.value.length >= MAX_REFERENCES) break
    if (!file.type.startsWith('image/') || tooBig(file)) continue
    try {
      references.value = [...references.value, await readImage(file)]
      refUrls.value = [...refUrls.value, '']
    } catch (err) {
      notify({
        kind: 'error',
        title: 'Could not attach the screenshot',
        detail: (err as Error).message,
        key: 'brief-attach',
      })
    }
  }
}

function removeReference(index: number) {
  references.value = references.value.filter((_, i) => i !== index)
  refUrls.value = refUrls.value.filter((_, i) => i !== index)
}

/**
 * The locale picker: the codes the project already carries plus whatever is
 * typed. The first one is the default, which is why it is a list and not a set.
 */
const localeDraft = ref('')
const chosenLocales = computed(() => answers.value.locales ?? [...locales.value])

function addLocaleChoice() {
  const code = localeDraft.value.trim().toLowerCase()
  localeDraft.value = ''
  if (!code || chosenLocales.value.includes(code)) return
  answers.value = { ...answers.value, locales: [...chosenLocales.value, code] }
}

function removeLocaleChoice(code: string) {
  const kept = chosenLocales.value.filter((c) => c !== code)
  if (!kept.length) return
  answers.value = { ...answers.value, locales: kept }
}

/** the way Settings names one: the code, which is what the person typed */
const localeName = (code: string) => code.toUpperCase()

/**
 * Finish: the writes first, THEN the send.
 *
 * A token is a fact, a sentence is a wish — the palette, the radius scale, the
 * colour mode, the fonts and the locales go into the project through the same
 * `useSettings` / `useLocale` path Settings → Design uses, so `useThemeTokens`
 * restyles the canvas live and undo covers them. The prompt then tells the
 * model they are already set. If a run shows the agent "setting the theme"
 * after a brief, the write did not land before the send.
 */
async function build() {
  if (!canBuild.value || busy.value) return
  busy.value = true
  try {
    const compiled = compileBrief({
      ...answers.value,
      logoPath: logo.value?.path,
      references: references.value.map((r, i) => ({
        name: r.name,
        url: refUrls.value[i] || undefined,
      })),
    })

    if (compiled.tokens.length) {
      const byName = new Map(compiled.tokens.map((t) => [t.name, t]))
      settings.value.tokens = [
        ...settings.value.tokens.filter((t) => !byName.has(t.name)),
        ...compiled.tokens,
      ]
    }
    if (compiled.radius || compiled.colorMode) {
      const theme = (settings.value.theme ??= {})
      if (compiled.radius) theme.radius = { ...(theme.radius ?? {}), ...compiled.radius }
      if (compiled.colorMode) theme.colorMode = compiled.colorMode
    }
    if (compiled.fonts) {
      settings.value.fonts = { ...settings.value.fonts, ...compiled.fonts }
    }
    if (compiled.locales) {
      for (const code of compiled.locales.codes) addLocale(code)
      setDefaultLocale(compiled.locales.defaultLocale)
    }

    emit(
      'send',
      compiled.prompt,
      references.value.map(({ mediaType, data, url }) => ({ mediaType, data, url })),
    )
    answers.value = {}
    references.value = []
    refUrls.value = []
    logo.value = null
    step.value = 0
  } finally {
    busy.value = false
  }
}

const chipClass =
  '!h-auto justify-start !px-2 py-1.5 text-left leading-snug whitespace-normal'
</script>

<template>
  <section
    data-brief
    aria-label="Build a brief"
    class="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2.5 pt-3 pb-3"
  >
    <header class="flex items-center gap-1">
      <span class="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
        Brief · {{ step + 1 }} of {{ SCREENS.length }}
      </span>
      <ButtonUI
        variant="icon"
        size="xs"
        :icon="X"
        aria-label="Close the brief"
        class="w-5 text-muted-foreground"
        data-brief-close
        @click="emit('close')"
      />
    </header>

    <h2 :data-brief-step="step" class="px-0.5 text-[11px] leading-relaxed font-medium">
      {{ SCREENS[step] }}
    </h2>

    <div class="flex min-h-0 flex-col gap-2">
      <template v-if="step === 0">
        <InputUI
          :model-value="answers.subject ?? ''"
          
          placeholder="What is it? e.g. a coming-soon page for Acme"
          data-brief-subject
          @update:model-value="answers = { ...answers, subject: $event }"
        />
        <InputUI
          :model-value="answers.audience ?? ''"
          
          placeholder="Who is it for?"
          data-brief-audience
          @update:model-value="answers = { ...answers, audience: $event }"
        />
      </template>

      <div v-else-if="step === 1" class="flex flex-col items-stretch gap-1">
        <ButtonUI
          v-for="goal in BRIEF_GOALS"
          :key="goal"
          size="xs"
          :variant="answers.goal === goal ? 'default' : 'outline'"
          :class="chipClass"
          data-brief-chip
          @click="answers = { ...answers, goal }"
        >
          {{ goal }}
        </ButtonUI>
        <InputUI
          :model-value="answers.goal ?? ''"
          
          placeholder="…or say it yourself"
          @update:model-value="answers = { ...answers, goal: $event }"
        />
      </div>

      <div v-else-if="step === 2" class="flex flex-wrap gap-1">
        <ButtonUI
          v-for="page in BRIEF_PAGES"
          :key="page"
          size="xs"
          :variant="picked('pages', page) ? 'default' : 'outline'"
          data-brief-chip
          @click="toggle('pages', page)"
        >
          {{ page }}
        </ButtonUI>
      </div>

      <div v-else-if="step === 3" class="flex flex-col gap-2">
        <div class="flex flex-col items-stretch gap-1">
          <ButtonUI
            v-for="palette in BRIEF_PALETTES"
            :key="palette.name"
            size="xs"
            :variant="answers.palette === palette.name ? 'default' : 'outline'"
            :class="chipClass"
            data-brief-chip
            :data-brief-palette="palette.name"
            @click="answers = { ...answers, palette: palette.name }"
          >
            <span class="flex min-w-0 flex-1 items-center gap-1.5">
              <span class="flex shrink-0 gap-0.5">
                <span
                  v-for="(hex, i) in palette.swatch"
                  :key="i"
                  class="size-2.5 rounded-full border border-input"
                  :style="{ background: hex }"
                />
              </span>
              <span class="truncate">{{ palette.name }}</span>
            </span>
          </ButtonUI>
        </div>
        <div class="flex flex-col gap-1 pt-1">
          <div
            v-for="slot in (['primary', 'accent', 'background'] as const)"
            :key="slot"
            class="flex items-center gap-2"
          >
            <span class="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{{ slot }}</span>
            <ColorPickerUI
              :model-value="answers.colors?.[slot] ?? ''"
              size="sm"
              output="hex"
              @update:model-value="
                answers = { ...answers, colors: { ...(answers.colors ?? {}), [slot]: $event } }
              "
            />
          </div>
        </div>
      </div>

      <div v-else-if="step === 4" class="flex flex-wrap gap-1">
        <ButtonUI
          v-for="mode in COLOR_MODES"
          :key="mode.value"
          size="xs"
          :variant="answers.colorMode === mode.value ? 'default' : 'outline'"
          data-brief-chip
          :data-brief-mode="mode.value"
          @click="answers = { ...answers, colorMode: mode.value }"
        >
          {{ mode.label }}
        </ButtonUI>
      </div>

      <div v-else-if="step === 5" class="flex flex-col gap-2">
        <SliderUI
          :model-value="stopOf('shape')"
          :min="0"
          :max="3"
          :step="1"
          aria-label="Shape"
          data-brief-shape
          @update:model-value="setStop('shape', $event)"
        />
        <p class="text-[10px] text-muted-foreground" data-brief-shape-name>
          {{ BRIEF_SHAPES[stopOf('shape')]?.name }}
        </p>
      </div>

      <div v-else-if="step === 6" class="flex flex-col gap-2">
        <SliderUI
          :model-value="stopOf('grid')"
          :min="0"
          :max="3"
          :step="1"
          aria-label="Grid"
          data-brief-grid
          @update:model-value="setStop('grid', $event)"
        />
        <p class="text-[10px] text-muted-foreground">{{ BRIEF_GRIDS[stopOf('grid')]?.name }}</p>
      </div>

      <div v-else-if="step === 7" class="flex flex-col gap-2">
        <SliderUI
          :model-value="stopOf('motion')"
          :min="0"
          :max="3"
          :step="1"
          aria-label="Motion"
          data-brief-motion
          @update:model-value="setStop('motion', $event)"
        />
        <p class="text-[10px] text-muted-foreground">{{ BRIEF_MOTIONS[stopOf('motion')]?.name }}</p>
      </div>

      <div v-else-if="step === 8" class="flex flex-col gap-2">
        <div class="flex flex-wrap gap-1">
          <ButtonUI
            v-for="tone in BRIEF_TONES"
            :key="tone"
            size="xs"
            :variant="picked('tone', tone) ? 'default' : 'outline'"
            data-brief-chip
            @click="toggle('tone', tone)"
          >
            {{ tone }}
          </ButtonUI>
        </div>
        <div class="flex flex-wrap gap-1 border-t border-input pt-2">
          <ButtonUI
            v-for="direction in FONT_DIRECTIONS"
            :key="direction"
            size="xs"
            :variant="answers.font === direction ? 'default' : 'outline'"
            data-brief-chip
            :data-brief-font="direction"
            @click="answers = { ...answers, font: direction }"
          >
            {{ direction }}
          </ButtonUI>
        </div>
      </div>

      <div v-else-if="step === 9" class="flex flex-wrap gap-1">
        <ButtonUI
          v-for="kind in BRIEF_IMAGERY"
          :key="kind"
          size="xs"
          :variant="picked('imagery', kind) ? 'default' : 'outline'"
          data-brief-chip
          @click="toggle('imagery', kind)"
        >
          {{ kind }}
        </ButtonUI>
      </div>

      <div v-else-if="step === 10" class="flex flex-col gap-2">
        <p class="text-[10px] text-muted-foreground">
          The first is the default. Content is written translatable from the first page.
        </p>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="(code, i) in chosenLocales"
            :key="code"
            data-brief-locale
            class="flex items-center gap-1 rounded-lg border border-input px-1.5 py-0.5 text-[10px]"
          >
            {{ localeName(code) }}<span v-if="i === 0" class="text-muted-foreground">· default</span>
            <ButtonUI
              v-if="chosenLocales.length > 1"
              variant="icon"
              size="xs"
              :icon="X"
              :aria-label="`Remove ${localeName(code)}`"
              class="w-4 text-muted-foreground"
              @click="removeLocaleChoice(code)"
            />
          </span>
        </div>
        <div class="flex items-center gap-1">
          <InputUI
            v-model="localeDraft"
            placeholder="Add a language code, e.g. fr"
            data-brief-locale-input
            @keydown.enter.prevent="addLocaleChoice"
          />
          <ButtonUI size="xs" data-brief-locale-add @click="addLocaleChoice">Add</ButtonUI>
        </div>
      </div>

      <div v-else-if="step === 11" class="flex flex-col gap-2">
        <ButtonUI size="xs" :class="chipClass" data-brief-logo @click="logoInput?.click()">
          {{ logo ? logo.name : 'Upload a logo' }}
        </ButtonUI>
        <p v-if="logo" class="truncate font-mono text-[9px] text-muted-foreground">
          {{ logo.path }}
        </p>
        <InputUI
          :model-value="answers.brandFonts ?? ''"
          
          placeholder="Brand font names, if any"
          @update:model-value="answers = { ...answers, brandFonts: $event }"
        />
        <input
          ref="logoInput"
          type="file"
          accept="image/*"
          class="hidden"
          data-brief-logo-file
          @change="onLogo"
        />
      </div>

      <div v-else-if="step === 12" class="flex flex-col gap-2">
        <p class="text-[10px] text-muted-foreground">
          The screenshot is what the agent reads — it cannot open a link, so a URL is only a note
          beside it.
        </p>
        <div v-for="(shot, i) in references" :key="i" class="flex items-start gap-1.5">
          <img :src="shot.url" alt="" class="size-10 shrink-0 rounded-md border border-input object-cover" />
          <InputUI
            :model-value="refUrls[i] ?? ''"
            placeholder="A URL, optional"
            @update:model-value="refUrls = refUrls.map((u, j) => (j === i ? $event : u))"
          />
          <ButtonUI
            variant="icon"
            size="xs"
            :icon="X"
            aria-label="Remove this reference"
            class="w-5 shrink-0 text-muted-foreground"
            @click="removeReference(i)"
          />
        </div>
        <ButtonUI
          v-if="references.length < MAX_REFERENCES"
          size="xs"
          :class="chipClass"
          data-brief-reference
          @click="refInput?.click()"
        >
          Add a screenshot
        </ButtonUI>
        <input
          ref="refInput"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          data-brief-reference-file
          @change="onReferences"
        />
      </div>

      <TextareaUI
        v-else
        :model-value="answers.law ?? ''"
        :rows="5"
        placeholder="Real copy, email addresses, links, names — anything I must use verbatim, or must not make up."
        data-brief-law
        @update:model-value="answers = { ...answers, law: $event }"
      />
    </div>

    <footer class="flex items-center gap-1 pt-1">
      <ButtonUI
        v-if="step > 0"
        variant="ghost"
        size="xs"
        :icon="ArrowLeft"
        aria-label="Back"
        data-brief-back
        @click="back"
      />
      <span class="flex-1" />
      <ButtonUI
        v-if="step > 0 && !last"
        variant="ghost"
        size="xs"
        class="text-muted-foreground"
        data-brief-skip
        @click="skip"
      >
        Skip
      </ButtonUI>
      <!-- Finish SENDS, so Next on the last screen is never Finish: the only
           primary button on the screen is the one that does it. -->
      <ButtonUI v-if="!last" variant="outline" size="xs" data-brief-next @click="next">
        Next
      </ButtonUI>
      <ButtonUI
        v-else
        size="xs"
        :icon="Sparkles"
        :disabled="!canBuild || busy"
        data-brief-finish
        @click="build"
      >
        Build it
      </ButtonUI>
    </footer>
  </section>
</template>
