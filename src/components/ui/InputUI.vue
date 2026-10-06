<script setup lang="ts">
import { computed, ref } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'

type Size = 'default' | 'lg'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    type?: string
    size?: Size
  }>(),
  { type: 'text', size: 'default' },
)

const model = defineModel<string>({ default: '' })

const isPassword = computed(() => props.type === 'password')
const revealed = ref(false)
const effectiveType = computed(() =>
  isPassword.value && revealed.value ? 'text' : props.type,
)

const base =
  'w-full placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent'

const sizes: Record<Size, string> = {
  default: 'h-7 px-2 text-xs rounded-lg bg-input outline-none ',
  lg: 'h-12 px-3 text-xs rounded-xl border border-input outline-none',
}

const classes = computed(() => [
  base,
  sizes[props.size],
  isPassword.value && (props.size === 'lg' ? 'pr-10' : 'pr-7'),
])

const el = ref<HTMLInputElement>()
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <!-- flex, not block: an inline input in a block wrapper gains descender
       space below it, which pulled the eye button off the input's centre -->
  <div v-if="isPassword" class="relative flex w-full">
    <input
      ref="el"
      v-model="model"
      :type="effectiveType"
      spellcheck="false"
      :placeholder="placeholder"
      :class="classes"
    />
    <button
      type="button"
      tabindex="-1"
      class="absolute inset-y-0 flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
      :class="size === 'lg' ? 'right-3' : 'right-2'"
      @click="revealed = !revealed"
    >
      <EyeOff v-if="revealed" class="size-4" />
      <Eye v-else class="size-4" />
    </button>
  </div>
  <input
    v-else
    ref="el"
    v-model="model"
    :type="type"
    spellcheck="false"
    :placeholder="placeholder"
    :class="classes"
  />
</template>
