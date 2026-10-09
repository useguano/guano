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

  classes?: string

  key?: string
}

export const paletteKey = (item: PaletteItem): string => item.key ?? item.type

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
      { type: 'custom-code', label: 'Custom code', icon: Code2 },
    ],
  },
]
