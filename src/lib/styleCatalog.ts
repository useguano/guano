import { SPACING } from './tieredBox'
import type { NamedFormat } from './valueClass'
import type { Control, Relevance, StyleSection } from './styles'

const FLEX = ['flex', 'inline-flex']
const GRID = ['grid', 'inline-grid']
const FLEX_GRID = [...FLEX, ...GRID]
const inFlex: Relevance = { when: 'display', values: FLEX }
const inGrid: Relevance = { when: 'display', values: GRID }
const inFlexGrid: Relevance = { when: 'display', values: FLEX_GRID }
const childOfFlex: Relevance = { when: 'parentDisplay', values: FLEX }
const childOfGrid: Relevance = { when: 'parentDisplay', values: GRID }
const childOfFlexGrid: Relevance = { when: 'parentDisplay', values: FLEX_GRID }
const positioned: Relevance = { when: 'positioned' }
const whenTransition: Relevance = { when: 'transition' }
const whenMediaOrBg: Relevance = { when: 'mediaOrBackground' }

const OPACITY = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']

const sel = (pairs: [string, string][]): Control => ({
  kind: 'select',
  options: pairs.map(([label, cls]) => ({ label, class: cls })),
})
const slide = (prefix: string, stops: string[] = SPACING): Control => ({ kind: 'slider', prefix, stops })
const slideC = (
  pairs: [string, string][],
  custom?: { prefix: string; format: NamedFormat },
): Control => ({
  kind: 'slider',
  classes: pairs.map(([, cls]) => cls),
  labels: pairs.map(([label]) => label),
  ...(custom ? { custom } : {}),
})
const signed = (prefix: string, mags: string[]): Control => {
  const neg = [...mags].reverse().map((m) => [`-${m}`, `-${prefix}-${m}`] as [string, string])
  const pos = mags.map((m) => [m, `${prefix}-${m}`] as [string, string])
  return slideC([...neg, ['0', `${prefix}-0`], ...pos])
}
const col = (prefix: string): Control => ({ kind: 'color', prefix })
const inp = (prefix: string, placeholder?: string): Control => ({ kind: 'input', prefix, placeholder })
const ico = (opts: [string, string, string][]): Control => ({
  kind: 'icons',
  options: opts.map(([label, cls, icon]) => ({ label, class: cls, icon })),
})

export const STYLE_SECTIONS: StyleSection[] = [
  {
    id: 'layout',
    label: 'Layout',
    properties: [
      {
        id: 'display',
        label: 'Display',
        control: ico([
          ['Block', 'block', 'Square'],
          ['Inline', 'inline', 'Baseline'],
          ['Flex', 'flex', 'StretchHorizontal'],
          ['Grid', 'grid', 'Grid3x3'],
          ['None', 'hidden', 'Ban'],
        ]),
      },
      {
        id: 'direction',
        label: 'Direction',
        needsDisplay: true,
        relevance: inFlex,
        control: ico([
          ['Row', 'flex-row', 'ArrowRight'],
          ['Column', 'flex-col', 'ArrowDown'],
          ['Row reverse', 'flex-row-reverse', 'ArrowLeft'],
          ['Col reverse', 'flex-col-reverse', 'ArrowUp'],
        ]),
      },
      {
        id: 'align',
        label: 'Align items',
        needsDisplay: true,
        relevance: inFlexGrid,
        control: ico([
          ['Start', 'items-start', 'AlignStartHorizontal'],
          ['Center', 'items-center', 'AlignCenterHorizontal'],
          ['End', 'items-end', 'AlignEndHorizontal'],
          ['Stretch', 'items-stretch', 'StretchVertical'],
          ['Baseline', 'items-baseline', 'Baseline'],
        ]),
      },
      {
        id: 'justify',
        label: 'Justify',
        needsDisplay: true,
        relevance: inFlexGrid,
        control: ico([
          ['Start', 'justify-start', 'AlignStartVertical'],
          ['Center', 'justify-center', 'AlignCenterVertical'],
          ['End', 'justify-end', 'AlignEndVertical'],
          ['Between', 'justify-between', 'AlignHorizontalSpaceBetween'],
          ['Around', 'justify-around', 'AlignHorizontalSpaceAround'],
          ['Evenly', 'justify-evenly', 'AlignHorizontalDistributeCenter'],
        ]),
      },
      {
        id: 'align-content',
        label: 'Align content',
        needsDisplay: true,
        relevance: inFlexGrid,
        control: ico([
          ['Start', 'content-start', 'AlignStartHorizontal'],
          ['Center', 'content-center', 'AlignCenterHorizontal'],
          ['End', 'content-end', 'AlignEndHorizontal'],
          ['Between', 'content-between', 'AlignVerticalSpaceBetween'],
          ['Around', 'content-around', 'AlignVerticalSpaceAround'],
          ['Evenly', 'content-evenly', 'AlignVerticalDistributeCenter'],
        ]),
      },
      { id: 'gap', label: 'Gap', needsDisplay: true, relevance: inFlexGrid, control: slide('gap') },
      {
        id: 'flex',
        label: 'Flex',
        relevance: childOfFlex,
        control: ico([
          ['1', 'flex-1', 'ChevronsLeftRight'],
          ['Auto', 'flex-auto', 'Expand'],
          ['Initial', 'flex-initial', 'Minimize2'],
          ['None', 'flex-none', 'Ban'],
        ]),
      },
      {
        id: 'grow',
        label: 'Grow',
        relevance: childOfFlex,
        control: ico([['Grow', 'grow', 'Maximize2'], ['No grow', 'grow-0', 'Ban']]),
      },
      {
        id: 'shrink',
        label: 'Shrink',
        relevance: childOfFlex,
        control: ico([['Shrink', 'shrink', 'Shrink'], ['No shrink', 'shrink-0', 'Ban']]),
      },
      { id: 'order', label: 'Order', relevance: childOfFlexGrid, control: inp('order', '1, first, last…'), default: 'order-1' },
      {
        id: 'grid-cols',
        label: 'Grid cols',
        relevance: inGrid,
        control: slideC([
          ['1', 'grid-cols-1'],
          ['2', 'grid-cols-2'],
          ['3', 'grid-cols-3'],
          ['4', 'grid-cols-4'],
          ['5', 'grid-cols-5'],
          ['6', 'grid-cols-6'],
          ['12', 'grid-cols-12'],
        ]),
      },
      {
        id: 'grid-rows',
        label: 'Grid rows',
        relevance: inGrid,
        control: slide('grid-rows', ['1', '2', '3', '4', '5', '6']),
      },
      {
        id: 'col-span',
        label: 'Col span',
        relevance: childOfGrid,
        control: slideC([
          ['1', 'col-span-1'],
          ['2', 'col-span-2'],
          ['3', 'col-span-3'],
          ['4', 'col-span-4'],
          ['5', 'col-span-5'],
          ['6', 'col-span-6'],
          ['Full', 'col-span-full'],
        ]),
      },
      {
        id: 'row-span',
        label: 'Row span',
        relevance: childOfGrid,
        control: slideC([
          ['1', 'row-span-1'],
          ['2', 'row-span-2'],
          ['3', 'row-span-3'],
          ['4', 'row-span-4'],
          ['5', 'row-span-5'],
          ['6', 'row-span-6'],
          ['Full', 'row-span-full'],
        ]),
      },
      {
        id: 'self',
        label: 'Self align',
        relevance: childOfFlexGrid,
        control: ico([
          ['Auto', 'self-auto', 'Dot'],
          ['Start', 'self-start', 'AlignStartHorizontal'],
          ['Center', 'self-center', 'AlignCenterHorizontal'],
          ['End', 'self-end', 'AlignEndHorizontal'],
          ['Stretch', 'self-stretch', 'StretchVertical'],
        ]),
      },
      {
        id: 'justify-self',
        label: 'Justify self',
        relevance: childOfGrid,
        control: ico([
          ['Auto', 'justify-self-auto', 'Dot'],
          ['Start', 'justify-self-start', 'AlignStartVertical'],
          ['Center', 'justify-self-center', 'AlignCenterVertical'],
          ['End', 'justify-self-end', 'AlignEndVertical'],
          ['Stretch', 'justify-self-stretch', 'StretchHorizontal'],
        ]),
      },
    ],
  },
  {
    id: 'position',
    label: 'Position',
    properties: [
      {
        id: 'position',
        label: 'Position',
        control: sel([
          ['Static', 'static'],
          ['Relative', 'relative'],
          ['Absolute', 'absolute'],
          ['Fixed', 'fixed'],
          ['Sticky', 'sticky'],
        ]),
      },
      { id: 'top', label: 'Top', control: slide('top'), relevance: positioned },
      { id: 'right', label: 'Right', control: slide('right'), relevance: positioned },
      { id: 'bottom', label: 'Bottom', control: slide('bottom'), relevance: positioned },
      { id: 'left', label: 'Left', control: slide('left'), relevance: positioned },
      {
        id: 'z-index',
        label: 'Z-index',
        control: slide('z', ['0', '10', '20', '30', '40', '50']),
        relevance: positioned,
      },
    ],
  },
  {
    id: 'size',
    label: 'Size',
    properties: [
      { id: 'width', label: 'Width', control: inp('w', 'full, 64, 1/2…') },
      { id: 'height', label: 'Height', control: inp('h', 'full, 64, screen…') },
      { id: 'min-width', label: 'Min width', control: inp('min-w', '0, full…') },
      { id: 'max-width', label: 'Max width', control: inp('max-w', 'sm, md, xl…') },
      { id: 'min-height', label: 'Min height', control: inp('min-h', '0, screen…') },
      { id: 'max-height', label: 'Max height', control: inp('max-h', 'full, screen…') },
      {
        id: 'overflow',
        label: 'Overflow',
        control: ico([
          ['Visible', 'overflow-visible', 'Eye'],
          ['Hidden', 'overflow-hidden', 'EyeOff'],
          ['Scroll', 'overflow-scroll', 'Scroll'],
          ['Auto', 'overflow-auto', 'MoveVertical'],
        ]),
      },
    ],
  },
  {
    id: 'spacing',
    label: 'Spacing',
    properties: [
      { id: 'padding', label: 'Padding', control: slide('p') },
      { id: 'margin', label: 'Margin', control: slide('m') },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    properties: [
      { id: 'text-color', label: 'Color', control: col('text') },
      {
        id: 'font-family',
        label: 'Font',
        control: sel([['Sans', 'font-sans'], ['Serif', 'font-serif'], ['Mono', 'font-mono']]),
      },
      {
        id: 'font-size',
        label: 'Size',
        control: slideC(
          [
            ['XS', 'text-xs'],
            ['SM', 'text-sm'],
            ['Base', 'text-base'],
            ['LG', 'text-lg'],
            ['XL', 'text-xl'],
            ['2XL', 'text-2xl'],
            ['3XL', 'text-3xl'],
            ['4XL', 'text-4xl'],
            ['5XL', 'text-5xl'],
            ['6XL', 'text-6xl'],
            ['7XL', 'text-7xl'],
            ['8XL', 'text-8xl'],
            ['9XL', 'text-9xl'],
          ],
          { prefix: 'text', format: 'length' },
        ),
      },
      {
        id: 'font-weight',
        label: 'Weight',
        control: slideC(
          [
            ['Thin', 'font-thin'],
            ['Extralight', 'font-extralight'],
            ['Light', 'font-light'],
            ['Normal', 'font-normal'],
            ['Medium', 'font-medium'],
            ['Semibold', 'font-semibold'],
            ['Bold', 'font-bold'],
            ['Extrabold', 'font-extrabold'],
            ['Black', 'font-black'],
          ],
          { prefix: 'font', format: 'weight' },
        ),
      },
      {
        id: 'text-align',
        label: 'Align',
        control: ico([
          ['Left', 'text-left', 'AlignLeft'],
          ['Center', 'text-center', 'AlignCenter'],
          ['Right', 'text-right', 'AlignRight'],
          ['Justify', 'text-justify', 'AlignJustify'],
        ]),
      },
      {
        id: 'line-height',
        label: 'Line height',
        control: slideC(
          [
            ['None', 'leading-none'],
            ['Tight', 'leading-tight'],
            ['Snug', 'leading-snug'],
            ['Normal', 'leading-normal'],
            ['Relaxed', 'leading-relaxed'],
            ['Loose', 'leading-loose'],
          ],
          { prefix: 'leading', format: 'line-height' },
        ),
      },
      {
        id: 'letter-spacing',
        label: 'Letter spacing',
        control: slideC(
          [
            ['Tighter', 'tracking-tighter'],
            ['Tight', 'tracking-tight'],
            ['Normal', 'tracking-normal'],
            ['Wide', 'tracking-wide'],
            ['Wider', 'tracking-wider'],
            ['Widest', 'tracking-widest'],
          ],
          { prefix: 'tracking', format: 'tracking' },
        ),
      },
      {
        id: 'text-transform',
        label: 'Transform',
        control: ico([
          ['Uppercase', 'uppercase', 'CaseUpper'],
          ['Lowercase', 'lowercase', 'CaseLower'],
          ['Capitalize', 'capitalize', 'CaseSensitive'],
          ['Normal', 'normal-case', 'Ban'],
        ]),
      },
      {
        id: 'text-decoration',
        label: 'Decoration',
        control: ico([
          ['Underline', 'underline', 'Underline'],
          ['Overline', 'overline', 'Minus'],
          ['Line through', 'line-through', 'Strikethrough'],
          ['None', 'no-underline', 'Ban'],
        ]),
      },
      {
        id: 'word-break',
        label: 'Word break',
        control: ico([
          ['Normal', 'break-normal', 'AlignJustify'],
          ['Words', 'break-words', 'WrapText'],
          ['All', 'break-all', 'ChevronsLeftRight'],
          ['Keep', 'break-keep', 'Ban'],
        ]),
      },
      {
        id: 'list-style',
        label: 'List',
        control: ico([
          ['None', 'list-none', 'Ban'],
          ['Disc', 'list-disc', 'List'],
          ['Decimal', 'list-decimal', 'ListOrdered'],
        ]),
      },
    ],
  },
  {
    id: 'background',
    label: 'Background',
    properties: [
      { id: 'bg-color', label: 'Color', control: col('bg') },
      {
        id: 'object-fit',
        label: 'Object fit',
        relevance: whenMediaOrBg,
        control: sel([
          ['Contain', 'object-contain'],
          ['Cover', 'object-cover'],
          ['Fill', 'object-fill'],
          ['None', 'object-none'],
          ['Scale down', 'object-scale-down'],
        ]),
      },
      {
        id: 'object-position',
        label: 'Object position',
        relevance: whenMediaOrBg,
        control: sel([
          ['Center', 'object-center'],
          ['Top', 'object-top'],
          ['Bottom', 'object-bottom'],
          ['Left', 'object-left'],
          ['Right', 'object-right'],
        ]),
      },
      {
        id: 'bg-size',
        label: 'BG size',
        relevance: whenMediaOrBg,
        control: sel([['Auto', 'bg-auto'], ['Cover', 'bg-cover'], ['Contain', 'bg-contain']]),
      },
      {
        id: 'bg-repeat',
        label: 'BG repeat',
        relevance: whenMediaOrBg,
        control: sel([
          ['Repeat', 'bg-repeat'],
          ['No repeat', 'bg-no-repeat'],
          ['Repeat X', 'bg-repeat-x'],
          ['Repeat Y', 'bg-repeat-y'],
        ]),
      },
    ],
  },
  {
    id: 'border',
    label: 'Border',
    properties: [
      { id: 'border-color', label: 'Color', control: col('border') },
      {
        id: 'radius',
        label: 'Radius',
        control: slideC(
          [
            ['None', 'rounded-none'],
            ['XS', 'rounded-xs'],
            ['SM', 'rounded-sm'],
            ['MD', 'rounded-md'],
            ['LG', 'rounded-lg'],
            ['XL', 'rounded-xl'],
            ['2XL', 'rounded-2xl'],
            ['3XL', 'rounded-3xl'],
            ['Full', 'rounded-full'],
          ],
          { prefix: 'rounded', format: 'length' },
        ),
      },
      {
        id: 'border-style',
        label: 'Style',
        control: sel([
          ['Solid', 'border-solid'],
          ['Dashed', 'border-dashed'],
          ['Dotted', 'border-dotted'],
          ['Double', 'border-double'],
          ['None', 'border-none'],
        ]),
      },
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    properties: [
      { id: 'opacity', label: 'Opacity', control: slide('opacity', OPACITY), default: 'opacity-100' },
      {
        id: 'shadow',
        label: 'Shadow',
        control: slideC([
          ['None', 'shadow-none'],
          ['XS', 'shadow-xs'],
          ['SM', 'shadow-sm'],
          ['MD', 'shadow-md'],
          ['LG', 'shadow-lg'],
          ['XL', 'shadow-xl'],
          ['2XL', 'shadow-2xl'],
        ]),
      },
      {
        id: 'blur',
        label: 'Blur',
        control: slideC([
          ['None', 'blur-none'],
          ['XS', 'blur-xs'],
          ['SM', 'blur-sm'],
          ['MD', 'blur-md'],
          ['LG', 'blur-lg'],
          ['XL', 'blur-xl'],
          ['2XL', 'blur-2xl'],
          ['3XL', 'blur-3xl'],
        ]),
      },
    ],
  },
  {
    id: 'transitions',
    label: 'Transitions',
    properties: [
      {
        id: 'transition',
        label: 'Transition',
        control: sel([
          ['None', 'transition-none'],
          ['All', 'transition-all'],
          ['Default', 'transition'],
          ['Colors', 'transition-colors'],
          ['Opacity', 'transition-opacity'],
          ['Transform', 'transition-transform'],
          ['Shadow', 'transition-shadow'],
        ]),
      },
      {
        id: 'duration',
        label: 'Duration',
        relevance: whenTransition,
        control: slide('duration', ['75', '100', '150', '200', '300', '500', '700', '1000']),
      },
      {
        id: 'timing',
        label: 'Easing',
        relevance: whenTransition,
        control: ico([
          ['Linear', 'ease-linear', 'Minus'],
          ['In', 'ease-in', 'Turtle'],
          ['Out', 'ease-out', 'Rabbit'],
          ['In out', 'ease-in-out', 'Spline'],
        ]),
      },
      {
        id: 'delay',
        label: 'Delay',
        relevance: whenTransition,
        control: slide('delay', ['75', '150', '300', '500', '700', '1000']),
      },
    ],
  },
  {
    id: 'transform',
    label: 'Transform',
    properties: [
      {
        id: 'scale',
        label: 'Scale',
        control: slide('scale', ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150']),
      },
      {
        id: 'transform-origin',
        label: 'Origin',
        control: {
          kind: 'select',
          options: [
            { label: 'Center', class: 'origin-center' },
            { label: 'Top', class: 'origin-top' },
            { label: 'Top right', class: 'origin-top-right' },
            { label: 'Right', class: 'origin-right' },
            { label: 'Bottom right', class: 'origin-bottom-right' },
            { label: 'Bottom', class: 'origin-bottom' },
            { label: 'Bottom left', class: 'origin-bottom-left' },
            { label: 'Left', class: 'origin-left' },
            { label: 'Top left', class: 'origin-top-left' },
          ],
        },
      },
      { id: 'rotate', label: 'Rotate', control: signed('rotate', ['1', '2', '3', '6', '12', '45', '90', '180']) },
      { id: 'translate-x', label: 'Translate X', control: signed('translate-x', ['1', '2', '3', '4', '6', '8']) },
      { id: 'translate-y', label: 'Translate Y', control: signed('translate-y', ['1', '2', '3', '4', '6', '8']) },
    ],
  },
  {
    id: 'interactivity',
    label: 'Interactivity',
    properties: [
      {
        id: 'cursor',
        label: 'Cursor',
        control: sel([
          ['Auto', 'cursor-auto'],
          ['Default', 'cursor-default'],
          ['Pointer', 'cursor-pointer'],
          ['Wait', 'cursor-wait'],
          ['Text', 'cursor-text'],
          ['Move', 'cursor-move'],
          ['Not allowed', 'cursor-not-allowed'],
        ]),
      },
      {
        id: 'user-select',
        label: 'User select',
        control: sel([
          ['None', 'select-none'],
          ['Text', 'select-text'],
          ['All', 'select-all'],
          ['Auto', 'select-auto'],
        ]),
      },
      {
        id: 'pointer-events',
        label: 'Pointer events',
        control: ico([
          ['None', 'pointer-events-none', 'Ban'],
          ['Auto', 'pointer-events-auto', 'MousePointer2'],
        ]),
      },
    ],
  },
]
