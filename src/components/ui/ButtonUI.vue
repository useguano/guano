<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { Side } from '@/lib/floating'

type Variant = 'default' | 'outline' | 'ghost' | 'icon' | 'mono' | 'danger'
type Size = 'default' | 'lg' | 'sm' | 'xs'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    icon?: Component
    iconPosition?: 'before' | 'after'
    disabled?: boolean
    tooltip?: string
    tooltipSide?: Side
  }>(),
  {
    variant: 'default',
    size: 'default',
    iconPosition: 'before',
    disabled: false,
  },
)

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0'

const variants: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary',
  danger: 'bg-danger text-white hover:bg-danger/90',
  outline: 'border border-accent bg-transparent hover:bg-accent/30 hover:text-accent-foreground',
  ghost: 'bg-transparent hover:bg-accent/30 hover:text-accent-foreground',
  icon: 'bg-transparent hover:text-accent-foreground',
  mono: 'bg-transparent font-mono hover:bg-accent/30 hover:text-accent-foreground',
}

const sizes: Record<Size, string> = {
  default: 'h-9 px-4 text-sm [&_svg]:size-4',
  sm: 'h-9 px-3 text-xs [&_svg]:size-3.5',
  lg: 'h-10 px-6 text-base [&_svg]:size-5',
  xs: 'h-6 gap-1 px-2 text-[10px] [&_svg]:size-3',
}

const iconSizes: Record<Size, string> = {
  default: 'h-9 p-0 text-sm [&_svg]:size-4',
  sm: 'h-9 p-0 text-xs [&_svg]:size-3.5',
  lg: 'h-10 p-0 text-base [&_svg]:size-5',
  xs: 'h-6 gap-1 p-0 text-[10px] [&_svg]:size-3',
}

const monoSizes: Record<Size, string> = {
  default: 'h-9 gap-1.5 px-2 text-[10px] [&_svg]:size-3',
  sm: 'h-9 gap-1.5 px-2 text-[10px] [&_svg]:size-3',
  lg: 'h-10 gap-1.5 px-3 text-[10px] [&_svg]:size-3',
  xs: 'h-6 gap-1.5 px-2 text-[10px] [&_svg]:size-3',
}

const classes = computed(() => [
  base,
  variants[props.variant],
  props.variant === 'icon'
    ? iconSizes[props.size]
    : props.variant === 'mono'
      ? monoSizes[props.size]
      : sizes[props.size],
])
</script>

<template>
  <button
    v-tooltip="tooltip ? { text: tooltip, side: tooltipSide } : undefined"
    :aria-label="icon && !$slots.default ? tooltip : undefined"
    :class="classes"
    :disabled="disabled"
  >
    <component :is="icon" v-if="icon && iconPosition === 'before'" />
    <slot />
    <component :is="icon" v-if="icon && iconPosition === 'after'" />
  </button>
</template>
