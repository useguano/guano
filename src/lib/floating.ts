export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Placement = Side | `${Side}-start` | `${Side}-end`

export interface FloatingSize {
  width: number
  height: number
}

export interface FloatingOptions {
  placement: Placement
  offset?: number
  padding?: number
}

export interface FloatingPosition {
  left: number
  top: number
  side: Side
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

export function computeFloatingPosition(
  anchor: DOMRect,
  floating: FloatingSize,
  opts: FloatingOptions,
): FloatingPosition {
  const offset = opts.offset ?? 6
  const padding = opts.padding ?? 8
  const vw = window.innerWidth
  const vh = window.innerHeight

  const [prefSide, align = 'center'] = opts.placement.split('-') as [Side, 'start' | 'end' | 'center' | undefined]

  const mainFits = (side: Side): boolean => {
    switch (side) {
      case 'top': return anchor.top - offset - floating.height >= padding
      case 'bottom': return anchor.bottom + offset + floating.height <= vh - padding
      case 'left': return anchor.left - offset - floating.width >= padding
      case 'right': return anchor.right + offset + floating.width <= vw - padding
    }
  }

  let side = prefSide
  if (!mainFits(side) && mainFits(OPPOSITE[side])) side = OPPOSITE[side]

  const vertical = side === 'top' || side === 'bottom'

  let left: number
  let top: number
  if (side === 'top') top = anchor.top - offset - floating.height
  else if (side === 'bottom') top = anchor.bottom + offset
  else if (side === 'left') left = anchor.left - offset - floating.width
  else left = anchor.right + offset

  if (vertical) {
    left =
      align === 'start' ? anchor.left
      : align === 'end' ? anchor.right - floating.width
      : anchor.left + anchor.width / 2 - floating.width / 2
  } else {
    top =
      align === 'start' ? anchor.top
      : align === 'end' ? anchor.bottom - floating.height
      : anchor.top + anchor.height / 2 - floating.height / 2
  }

  left = Math.min(Math.max(left!, padding), Math.max(padding, vw - padding - floating.width))
  top = Math.min(Math.max(top!, padding), Math.max(padding, vh - padding - floating.height))

  return { left, top, side }
}
