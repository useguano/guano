export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Placement = Side | `${Side}-start` | `${Side}-end`

export interface FloatingSize {
  width: number
  height: number
}

export interface FloatingOptions {
  placement: Placement
  /** gap between anchor and floating box (px) */
  offset?: number
  /** minimum distance from the viewport edges (px) */
  padding?: number
}

export interface FloatingPosition {
  left: number
  top: number
  /** the side actually used after flipping */
  side: Side
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/**
 * Position a floating box (tooltip/popover) against an anchor rect in viewport
 * coordinates, for `position: fixed` rendering. Flips to the opposite side when
 * the preferred side would clip the viewport on the main axis (only if the
 * opposite side actually fits better), then clamps the cross axis into
 * [padding, viewport - padding]. Pure math — callers pass measured rects.
 */
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

  // main axis
  let left: number
  let top: number
  if (side === 'top') top = anchor.top - offset - floating.height
  else if (side === 'bottom') top = anchor.bottom + offset
  else if (side === 'left') left = anchor.left - offset - floating.width
  else left = anchor.right + offset

  // cross axis: start = leading edges aligned, end = trailing edges, center = midpoints
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

  // clamp both axes into the viewport (cross axis mainly; main axis as a last resort)
  left = Math.min(Math.max(left!, padding), Math.max(padding, vw - padding - floating.width))
  top = Math.min(Math.max(top!, padding), Math.max(padding, vh - padding - floating.height))

  return { left, top, side }
}
