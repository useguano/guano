<script setup lang="ts">

import { computed, ref, watch } from 'vue'
import { ChevronLeft, Copy, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import DrawerField from './DrawerField.vue'
import DrawerSection from './DrawerSection.vue'
import VariantAxesEditor from './VariantAxesEditor.vue'
import { useComponents } from '@/composables/useComponents'
import { useBranches } from '@/composables/useBranches'
import { useModal } from '@/composables/useModal'

const props = defineProps<{ componentId: string; focus?: 'variants' }>()
const emit = defineEmits<{ back: [] }>()

const { components, renameComponent, duplicateComponent, setCategory, usageOf, deleteComponent } =
  useComponents()
const { branches } = useBranches()
const { confirm } = useModal()

const component = computed(() => components.value.find((c) => c.id === props.componentId) ?? null)

watch(component, (c) => {
  if (!c) emit('back')
})

const usage = computed(() => (component.value ? usageOf(component.value.name) : null))

const otherDrafts = computed(() => branches.value.filter((b) => b.id !== 'main').length)

const categories = computed(() =>
  [...new Set(components.value.map((c) => c.category).filter((c): c is string => !!c))].sort(),
)

const nameField = ref('')
const categoryField = ref('')
watch(
  component,
  (c) => {
    if (!c) return
    nameField.value = c.name
    categoryField.value = c.category ?? ''
  },
  { immediate: true },
)

async function commitName() {
  const c = component.value
  const raw = nameField.value.trim()
  if (!c || !raw || raw === c.name) {
    nameField.value = c?.name ?? ''
    return
  }
  if (otherDrafts.value) {
    const ok = await confirm({
      title: 'Rename component',
      message: `Rename “${c.name}”? A draft still using the old name will reference a component that no longer exists once it is applied.`,
      confirmLabel: 'Rename',
    })
    if (!ok) {
      nameField.value = c.name
      return
    }
  }
  nameField.value = renameComponent(c.id, raw) ?? c.name
}

function commitCategory() {
  const c = component.value
  if (!c) return
  setCategory(c.id, categoryField.value)
  categoryField.value = c.category ?? ''
}

function onDuplicate() {
  const c = component.value
  if (c) duplicateComponent(c.id)
  emit('back')
}

async function onDelete() {
  const c = component.value
  const used = usage.value
  if (!c || !used) return
  const where =
    used.count === 0
      ? 'It isn’t used on any page.'
      : `It is used ${used.count === 1 ? 'once' : `${used.count} times`} on ${
          used.pages.length === 1 ? '1 page' : `${used.pages.length} pages`
        }. Those stay on the page as plain elements, keeping their look.`
  const draftNote = otherDrafts.value
    ? ' A draft still using it will reference a missing component once applied.'
    : ''
  const ok = await confirm({
    title: 'Delete component',
    message: `Delete “${c.name}”? ${where}${draftNote}`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  deleteComponent(c.id)
  emit('back')
}
</script>

<template>
  <div v-if="component" class="flex min-h-full flex-col">
    <div class="flex h-11 shrink-0 items-center gap-1 px-1.5">
      <ButtonUI
        variant="icon"
        size="sm"
        :icon="ChevronLeft"
        tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="emit('back')"
      />
      <span class="min-w-0 flex-1 truncate text-xs font-medium">Component settings</span>
    </div>

    <div class="flex flex-1 flex-col gap-5 px-2.5 pt-1 pb-3">
      <DrawerSection title="General">
        <DrawerField
          label="Name"
          hint="Its token in the code, and every instance follows."
        >
          <InputUI
            v-model="nameField"
            placeholder="Card"
            @blur="commitName"
            @keydown.enter="commitName"
          />
        </DrawerField>

        <DrawerField label="Category" hint="Groups it in this list. Blank = Uncategorized.">
          <InputUI
            v-model="categoryField"
            list="component-categories"
            placeholder="Uncategorized"
            @blur="commitCategory"
            @keydown.enter="commitCategory"
          />
          <datalist id="component-categories">
            <option v-for="name in categories" :key="name" :value="name" />
          </datalist>
        </DrawerField>
      </DrawerSection>

      <DrawerSection title="Variants">
        <VariantAxesEditor :component-id="component.id" :autofocus="focus === 'variants'" />
      </DrawerSection>

      <DrawerSection v-if="usage" title="Usage">
        <p class="text-[10px] text-muted-foreground">
          <template v-if="!usage.count">Not used on any page yet.</template>
          <template v-else>
            {{ usage.count }} {{ usage.count === 1 ? 'instance' : 'instances' }} on
            {{ usage.pages.map((p) => p.name).join(', ') }}.
          </template>
        </p>
      </DrawerSection>

      <div class="mt-auto flex gap-1 pt-2">
        <ButtonUI
          variant="ghost"
          size="sm"
          :icon="Copy"
          class="flex-1 justify-center text-muted-foreground"
          @click="onDuplicate"
        >
          Duplicate
        </ButtonUI>
        <ButtonUI
          variant="ghost"
          size="sm"
          :icon="Trash2"
          class="flex-1 justify-center !text-danger"
          @click="onDelete"
        >
          Delete
        </ButtonUI>
      </div>
    </div>
  </div>
</template>
