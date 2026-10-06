export const TAILWIND_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']

/** hex values per color, index-aligned with TAILWIND_SHADES */
// NOTE: these palette names must stay in sync with RESERVED_TOKEN_NAMES in
// src/lib/shared/tokens.js (which the token validator uses to reject
// tokens that would shadow a Tailwind color).
export const TAILWIND_COLORS: Record<string, string[]> = {
  slate: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a'],
  gray: ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827'],
  red: ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'],
  orange: ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12'],
  amber: ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'],
  yellow: ['#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12'],
  lime: ['#f7fee7', '#ecfccb', '#d9f99d', '#bef264', '#a3e635', '#84cc16', '#65a30d', '#4d7c0f', '#3f6212', '#365314'],
  green: ['#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d'],
  emerald: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b'],
  teal: ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a'],
  cyan: ['#ecfeff', '#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63'],
  sky: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e'],
  blue: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'],
  indigo: ['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81'],
  violet: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95'],
  purple: ['#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87'],
  fuchsia: ['#fdf4ff', '#fae8ff', '#f5d0fe', '#f0abfc', '#e879f9', '#d946ef', '#c026d3', '#a21caf', '#86198f', '#701a75'],
  pink: ['#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'],
  rose: ['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337'],
}

// project design tokens (bg-brand etc.) — synced by useSettings so the
// color helpers recognize them without this module becoming reactive
let TOKEN_HEX: Record<string, string> = {}

export function setColorTokens(map: Record<string, string>) {
  TOKEN_HEX = map
}

/** 'slate-100' or a design token name → is it a color class value? */
export function isPaletteColor(value: string): boolean {
  if (value in TOKEN_HEX) return true
  const match = value.match(/^([a-z]+)-(\d{2,3})$/)
  return !!match && match[1]! in TAILWIND_COLORS && TAILWIND_SHADES.includes(match[2]!)
}

/** css color for a picker value: 'slate-100', 'brand', 'white', '#ff0000' */
export function colorHex(value: string): string {
  if (TOKEN_HEX[value]) return TOKEN_HEX[value]
  if (value.startsWith('#')) return value
  if (value === 'white') return '#ffffff'
  if (value === 'black') return '#000000'
  if (value === 'transparent') return 'transparent'
  const match = value.match(/^([a-z]+)-(\d{2,3})$/)
  const hex = match && TAILWIND_COLORS[match[1]!]?.[TAILWIND_SHADES.indexOf(match[2]!)]
  return hex ?? '#888888'
}

const HEX_ANY_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Any CSS colour the browser understands → '#rrggbb' (or '#rrggbbaa' when
 * translucent), via a canvas fill-style round trip; null when it isn't one.
 * Pure hex passes straight through, so this works without a DOM too.
 */
export function cssColorToHex(value: string): string | null {
  const v = value.trim()
  if (HEX_ANY_RE.test(v)) return v.toLowerCase()
  if (typeof document === 'undefined') return null
  if (typeof CSS !== 'undefined' && !CSS.supports('color', v)) return null
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#000'
  ctx.fillStyle = v
  const out = String(ctx.fillStyle)
  if (out.startsWith('#')) return out
  // translucent colours read back as rgba(r, g, b, a)
  const m = out.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  if (!m) return null
  const part = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  const alpha = m[4] === undefined ? 1 : Number(m[4])
  return '#' + part(+m[1]!) + part(+m[2]!) + part(+m[3]!) + (alpha < 1 ? part(alpha * 255) : '')
}

/**
 * What a typed colour means as a picker value: a palette shade or design
 * token keeps its name ('slate-500', 'brand'), everything else the browser
 * accepts becomes hex. null = not a colour.
 */
export function parseColorInput(text: string): string | null {
  const v = text.trim().toLowerCase()
  if (!v) return null
  if (v === 'white' || v === 'black' || v === 'transparent') return v
  if (isPaletteColor(v)) return v
  return cssColorToHex(v)
}
