import type { Component } from 'vue'
import {
  Quote,
  ImagePlay,
  Captions,
  Square,
  SquareDashed,
  Container,
  LayoutGrid,
  Type,
  Heading,
  Pilcrow,
  Baseline,
  Tag,
  Image,
  Video,
  RectangleHorizontal,
  FormInput,
  TextCursorInput,
  SquareCheck,
  CircleDot,
  SquareChevronDown,
  MousePointerClick,
  List,
  Link,
  GalleryHorizontalEnd,
  Table,
  Rows3,
  Columns3,
  TableProperties,
  Smile,
  Code2,
} from 'lucide-vue-next'

export interface PaletteItem {
  type: string
  label: string
  icon: Component
  /**
   * Classes the insert lands with — what makes this a PRESET rather than a
   * type. `container` and `grid` used to be their own element types whose only
   * difference from a `div` was the name in this list; the v2 migration
   * collapsed them, and what the names were really offering was a styled div.
   */
  classes?: string
  /**
   * Stable address for this entry, defaulted to the type by `paletteKey`. A
   * preset needs its own, because several entries now share one type — and it
   * has to be stable rather than label-derived: it is the row key, and what
   * `[data-dock-item]` is queried by.
   */
  key?: string
}

/** how a palette entry is addressed: its own key, else its type */
export const paletteKey = (item: PaletteItem): string => item.key ?? item.type

/** the insertable built-in elements, grouped for browsing — shared by the
 * Elements popover (ElementsPalette) and the ⌘E command palette */
export const ELEMENT_GROUPS: { title: string; items: PaletteItem[] }[] = [
  {
    title: 'Layout',
    items: [
      { type: 'section', label: 'Section', icon: Square },
      { type: 'div', label: 'Div', icon: SquareDashed },
      {
        type: 'div',
        label: 'Container',
        key: 'div:container',
        icon: Container,
        classes: 'mx-auto w-full max-w-5xl px-6',
      },
      {
        type: 'div',
        label: 'Grid',
        key: 'div:grid',
        icon: LayoutGrid,
        classes: 'grid grid-cols-3 gap-6',
      },
    ],
  },
  {
    title: 'Text',
    items: [
      { type: 'text', label: 'Text', icon: Type },
      { type: 'h2', label: 'Heading', icon: Heading },
      { type: 'paragraph', label: 'Paragraph', icon: Pilcrow },
      { type: 'span', label: 'Span', icon: Baseline },
      { type: 'label', label: 'Label', icon: Tag },
      { type: 'blockquote', label: 'Quote', icon: Quote },
    ],
  },
  {
    title: 'Media',
    items: [
      { type: 'image', label: 'Image', icon: Image },
      { type: 'video', label: 'Video', icon: Video },
      { type: 'icon', label: 'Icon', icon: Smile },
      { type: 'figure', label: 'Figure', icon: ImagePlay },
      { type: 'figcaption', label: 'Caption', icon: Captions },
    ],
  },
  {
    // button and link are containers now (an icon sits beside the words), so
    // they read as actions rather than as a form control and a list row
    title: 'Actions',
    items: [
      { type: 'button', label: 'Button', icon: MousePointerClick },
      { type: 'link', label: 'Link', icon: Link },
    ],
  },
  {
    title: 'Forms',
    items: [
      { type: 'form', label: 'Form', icon: RectangleHorizontal },
      { type: 'input', label: 'Input', icon: FormInput },
      { type: 'textarea', label: 'Textarea', icon: TextCursorInput },
      { type: 'checkbox', label: 'Checkbox', icon: SquareCheck },
      { type: 'radio', label: 'Radio', icon: CircleDot },
      { type: 'select', label: 'Select', icon: SquareChevronDown },
      { type: 'fieldset', label: 'Fieldset', icon: SquareDashed },
    ],
  },
  {
    title: 'Lists',
    items: [
      { type: 'list', label: 'List', icon: List },
      { type: 'slider', label: 'Slider', icon: GalleryHorizontalEnd },
    ],
  },
  {
    title: 'Table',
    items: [
      { type: 'table', label: 'Table', icon: Table },
      { type: 'thead', label: 'Head', icon: TableProperties },
      { type: 'tbody', label: 'Body', icon: Rows3 },
      { type: 'tr', label: 'Row', icon: Rows3 },
      { type: 'th', label: 'Header cell', icon: Columns3 },
      { type: 'td', label: 'Cell', icon: Columns3 },
    ],
  },
  {
    title: 'Embed',
    items: [
      // raw HTML, emitted verbatim on the published page — see the registry
      { type: 'custom-code', label: 'Custom code', icon: Code2 },
    ],
  },
]
