// Element registry — the single source of truth shared VERBATIM by the
// TS client (via src/lib/elements.ts) and the node exporter
// (server/export.mjs), which can't import TypeScript. Plain-JS ESM so
// both can consume it directly. Types live in src/lib/elements.ts.
//
// tag: HTML tag rendered. defaultContent: placeholder text (marks a leaf).
// void: self-closing, no children/text. suggest: the natural first child of
// this block (it also marks a content-less type as a container, not a leaf).
// seed: the child a brand-new element of this type is created with. A button
// or a link is a CONTAINER (an icon, a badge and a label routinely sit inside
// one), so its words live in a child — and without a seed every insert would
// land an empty box the author has to fill before they can see anything.
export const ELEMENTS_DATA = {
  /** page root wrap — selectable but never added, removed, or reordered */
  body: { tag: 'div', suggest: 'section' },
  section: { tag: 'section', suggest: 'div' },
  div: { tag: 'div', suggest: 'h2' },
  container: { tag: 'div', suggest: 'div' },
  grid: { tag: 'div', suggest: 'div' },
  header: { tag: 'header', suggest: 'nav' },
  footer: { tag: 'footer', suggest: 'text' },
  article: { tag: 'article', suggest: 'h2' },
  nav: { tag: 'nav', suggest: 'link' },
  main: { tag: 'main', suggest: 'section' },
  aside: { tag: 'aside', suggest: 'h3' },
  text: { tag: 'div', defaultContent: 'Lorem ipsum' },
  h1: { tag: 'h1', defaultContent: 'Lorem ipsum' },
  h2: { tag: 'h2', defaultContent: 'Lorem ipsum' },
  h3: { tag: 'h3', defaultContent: 'Lorem ipsum' },
  h4: { tag: 'h4', defaultContent: 'Lorem ipsum' },
  h5: { tag: 'h5', defaultContent: 'Lorem ipsum' },
  h6: { tag: 'h6', defaultContent: 'Lorem ipsum' },
  heading: { tag: 'h2', defaultContent: 'Lorem ipsum' },
  label: { tag: 'label', suggest: 'span', seed: { type: 'span', content: 'Label' } },
  paragraph: { tag: 'p', defaultContent: 'Dolor sit amet' },
  span: { tag: 'span', defaultContent: 'Dolor sit amet' },
  // a quotation and a captioned media block — the two structures a
  // testimonial or an article pull-quote is made of. Containers: the words go
  // in a child, and <figcaption> is what a <figure> is FOR.
  blockquote: { tag: 'blockquote', suggest: 'paragraph' },
  figure: { tag: 'figure', suggest: 'image' },
  figcaption: { tag: 'figcaption', defaultContent: 'Caption' },
  list: { tag: 'ul', suggest: 'list-item' },
  // a container (its HTML <li> routinely wraps a tag/title/meta block); put a
  // :text: (or richer children) inside it rather than text on the row itself
  'list-item': { tag: 'li', suggest: 'text' },
  image: { tag: 'img', void: true },
  // an inline <svg>, so it follows the text colour and takes size/colour
  // classes like any element — which an <img> of an SVG never can. Its markup
  // is node state (`node.svg`), always sanitized: see shared/svg.js
  icon: { tag: 'svg', void: true },
  video: { tag: 'video' },
  form: { tag: 'form', suggest: 'input' },
  /**
   * A form's SUCCESS and ERROR states: direct children of a `form`, rendered
   * only after a submission lands (or fails). Their own types rather than a
   * styled div with a magic class, following the `list-empty` precedent — so
   * an author styles them like any element, they translate like any content,
   * and a misplaced one is a diagnostic instead of silently never rendering.
   */
  'form-success': { tag: 'div', suggest: 'text' },
  'form-error': { tag: 'div', suggest: 'text' },
  input: { tag: 'input', void: true },
  // a real multi-line control: a tall :input was the only way to express one,
  // which is visibly not the same element and behaves differently
  textarea: { tag: 'textarea' },
  // checkbox/radio are <input type=…>; the type is baked in so an author never
  // has to remember the attribute, and the `change` interaction trigger reads
  // their checked state
  checkbox: { tag: 'input', void: true, attrs: { type: 'checkbox' } },
  radio: { tag: 'input', void: true, attrs: { type: 'radio' } },
  fieldset: { tag: 'fieldset', suggest: 'legend' },
  legend: { tag: 'legend', defaultContent: 'Legend' },
  dropdown: { tag: 'select', suggest: 'option' },
  select: { tag: 'select', suggest: 'option' },
  option: { tag: 'option', defaultContent: 'Option' },
  button: { tag: 'button', suggest: 'span', seed: { type: 'span', content: 'Button' } },
  link: { tag: 'a', suggest: 'span', seed: { type: 'span', content: 'Link' } },
  table: { tag: 'table', suggest: 'thead' },
  thead: { tag: 'thead', suggest: 'tr' },
  tbody: { tag: 'tbody', suggest: 'tr' },
  tr: { tag: 'tr', suggest: 'td' },
  th: { tag: 'th', suggest: 'text' },
  td: { tag: 'td', suggest: 'text' },
  /** repeats its children once per entry of the collection in its arg */
  'collection-list': { tag: 'div', suggest: 'div' },
  /**
   * A list's EMPTY STATE: a direct child of a `:collection-list` (or a bound
   * `:slider`) that renders only when the list has no entries, and is never
   * repeated. Without it a filtered list that matched nothing rendered as a
   * blank gap, and the only workaround was to not filter.
   */
  'list-empty': { tag: 'div', suggest: 'text' },
  /** renders one picked entry through its collection's template */
  'collection-item': { tag: 'div', defaultContent: '' },
  /**
   * A block of RAW HTML — an embed, a widget's snippet, a script — emitted
   * verbatim into the published page inside a styleable <div>, and drawn as a
   * placeholder on the canvas and in Play (it is not rendered live anywhere
   * in the editor). A leaf: its content IS the code, and it is the one leaf
   * whose text no sanitizer touches, which is why writing it is gated like
   * the page's custom code — build roles and `allowCustomCode` agents only
   * (server/agent-policy.mjs codeSurface).
   */
  'custom-code': { tag: 'div', defaultContent: '' },
  /** carousel. With an arg it repeats its children per entry like a
   * :collection-list (one slide each); without one, each direct child is a
   * slide. Arrows/dots are built-in chrome — see shared/slider.js */
  slider: { tag: 'div', suggest: 'div' },
}
