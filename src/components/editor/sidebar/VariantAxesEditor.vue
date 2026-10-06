<script setup lang="ts">
/**
 * A component's variant axes: what its instances can differ along (`variant`,
 * `size`) and the options on each.
 *
 * This edits the NAMES only. What an option looks like is styled on the board
 * like anything else — wear the option on the card, then pick it under
 * "Editing" in the Style panel.
 *
 * Holds an id, never the object, like the pane it sits in.
 */
import { computed, ref } from 'vue'
import { Plus, Star, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import DrawerField from './DrawerField.vue'
import { useProject } from '@/composables/useProject'
import {
  addVariantAxis,
  addVariantOption,
  removeVariantAxis,
  removeVariantOption,
  renameVariantAxis,
  renameVariantOption,
  setVariantDefault,
  type VariantResult,
} from '@/lib/variantOps'

const props = defineProps<{ componentId: string }>()

const { project } = useProject()
const def = computed(() => project.value.components.find((c) => c.id === props.componentId) ?? null)
const axes = computed(() => def.value?.variants ?? [])

const error = ref('')
const newAxis = ref('')
/** the "add option" draft, per axis name */
const newOption = ref<Record<string, string>>({})

/** run an operation and show why it was refused, if it was */
function run(op: (d: NonNullable<typeof def.value>) => VariantResult): boolean {
  const d = def.value
  if (!d) return false
  const result = op(d)
  error.value = result.ok ? '' : result.error
  return result.ok
}

/** names are lowercase-with-dashes; meet the author halfway on the obvious */
const tidy = (raw: string) => raw.trim().toLowerCase().replace(/[\s_]+/g, '-')

function addAxis() {
  const name = tidy(newAxis.value)
  if (!name) return
  if (run((d) => addVariantAxis(project.value, d, name))) newAxis.value = ''
}

function addOption(axis: string) {
  const name = tidy(newOption.value[axis] ?? '')
  if (!name) return
  if (run((d) => addVariantOption(project.value, d, axis, name))) newOption.value[axis] = ''
}

function renameAxis(from: string, e: Event) {
  const input = e.target as HTMLInputElement
  const to = tidy(input.value)
  if (!to || !run((d) => renameVariantAxis(project.value, d, from, to))) input.value = from
}

function renameOption(axis: string, from: string, e: Event) {
  const input = e.target as HTMLInputElement
  const to = tidy(input.value)
  if (!to || !run((d) => renameVariantOption(project.value, d, axis, from, to))) input.value = from
}

const blur = (e: Event) => (e.target as HTMLInputElement).blur()
</script>

<template>
  <div class="flex flex-col gap-3" data-variant-axes>
    <p v-if="!axes.length" class="text-[10px] text-muted-foreground">
      None yet. An axis is a way its instances can look different: a variant, a size.
    </p>

    <DrawerField v-for="axis in axes" :key="axis.name" label="Axis" :data-variant-axis="axis.name">
      <template #end>
        <ButtonUI
          variant="icon"
          size="xs"
          :icon="X"
          class="text-muted-foreground"
          :aria-label="`Remove the ${axis.name} axis`"
          @click="run((d) => removeVariantAxis(project, d, axis.name))"
        />
      </template>

      <input
        :value="axis.name"
        type="text"
        spellcheck="false"
        class="h-7 w-full rounded-lg bg-input px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent"
        @blur="renameAxis(axis.name, $event)"
        @keydown.enter="blur"
      />

      <div class="flex flex-col gap-1 pl-2">
        <div
          v-for="option in axis.options"
          :key="option"
          class="flex items-center gap-1"
          :data-variant-option="option"
        >
          <ButtonUI
            variant="icon"
            size="xs"
            :icon="Star"
            :tooltip="option === axis.default ? 'The default' : 'Make this the default'"
            :class="option === axis.default ? 'text-foreground' : 'text-muted-foreground/40'"
            :aria-pressed="option === axis.default"
            @click="run((d) => setVariantDefault(project, d, axis.name, option))"
          />
          <input
            :value="option"
            type="text"
            spellcheck="false"
            class="h-6 min-w-0 flex-1 rounded-md bg-input px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
            @blur="renameOption(axis.name, option, $event)"
            @keydown.enter="blur"
          />
          <ButtonUI
            variant="icon"
            size="xs"
            :icon="X"
            class="text-muted-foreground"
            :disabled="axis.options.length === 1"
            :aria-label="`Remove ${option}`"
            @click="run((d) => removeVariantOption(project, d, axis.name, option))"
          />
        </div>
        <InputUI
          v-model="newOption[axis.name]"
          placeholder="Add an option…"
          @keydown.enter="addOption(axis.name)"
          @blur="addOption(axis.name)"
        />
      </div>
    </DrawerField>

    <div class="flex items-center gap-1">
      <InputUI v-model="newAxis" placeholder="New axis: size, variant…" @keydown.enter="addAxis" />
      <ButtonUI variant="icon" size="sm" :icon="Plus" tooltip="Add axis" class="w-7" @click="addAxis" />
    </div>
    <p v-if="error" class="text-[10px] text-danger" data-variant-error>{{ error }}</p>
  </div>
</template>
