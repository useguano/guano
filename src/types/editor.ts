export interface Interaction {
  id: string
  name: string
  toClasses: string
  duration: string
  easing: string

  modal?: boolean

  /** draw a dimming backdrop behind the target while the effect is on, and
   *  close the effect when it is clicked. A property of the EFFECT, like
   *  `modal`, `closeOn` and `group`. */
  scrim?: boolean
}

export type InteractionAction = 'toggle' | 'on' | 'off'

export type InteractionTrigger =
  | 'hover'
  | 'click'
  | 'appear'
  | 'scrolled'
  | 'change'
  | 'load'

export interface InteractionBinding {
  id: string
  interactionId: string
  trigger: InteractionTrigger

  targetId: string | null

  breakpoints?: string[]

  action?: InteractionAction

  closeOn?: ('outside' | 'escape')[]

  group?: string

  once?: 'session' | 'local'
  scrollAt?: number
}

export type AnimProp =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotate'
  | 'opacity'
  | 'blur'
  | 'brightness'
  | 'saturate'
  | 'bgColor'
  | 'textColor'
  | 'borderColor'
  | 'width'
  | 'height'
  | 'clipTop'
  | 'clipRight'
  | 'clipBottom'
  | 'clipLeft'
  | 'count'

export interface AnimationTrack {
  prop: AnimProp
  from?: number | string
  to: number | string

  format?: {
    decimals?: number
    group?: boolean
    prefix?: string
    suffix?: string
  }
}

export interface AnimationStep {
  id: string
  tracks: AnimationTrack[]
  duration: number
  easing: string
  offset?: number

  stagger?: number

  staggerSelector?: string
  repeat?: number
  yoyo?: boolean
}

export interface Effect {
  id: string
  name: string
  interactionId?: string
  animationId?: string
}

export interface Animation {
  id: string
  name: string
  steps: AnimationStep[]
}

export interface AnimationBinding {
  id: string
  animationId: string

  trigger: 'load' | 'appear' | 'scrub' | 'mouse' | 'hover' | 'click' | 'scrolled' | 'change'

  targetId: string | null

  action?: 'on' | 'off'

  scrollAt?: number
  appearMode?: 'once' | 'replay' | 'reverse'

  appearAt?: number

  scrub?: { start?: number; end?: number; smooth?: number }

  mouse?: { axis?: 'x' | 'y'; area?: 'element' | 'page'; smooth?: number }

  breakpoints?: string[]

  delay?: number
}

/** one condition on a list's entries; several are ANDed */
export interface ListFilter {
  field: string
  equals?: string
  notEmpty?: boolean

  /** matches the entry in scope BY ID — reference fields only */
  equalsCurrent?: boolean

  /** invert this one condition */
  not?: boolean
}

/** one mutation an action runs against the client-side entry store */
export type ActionOp =
  | { op: 'set'; field: string; value: string; entry?: string }
  | { op: 'toggle'; field: string; entry?: string }
  | { op: 'increment'; field: string; by?: number; entry?: string }
  | {
      op: 'create'
      collection: string
      values?: Record<string, string>

      /** a `data-draft` scope whose inputs supply the remaining values */
      from?: string
    }
  | { op: 'delete'; entry?: string }

/**
 * A data write bound to a trigger — the third engine, beside
 * `InteractionBinding` (classes) and `AnimationBinding` (tweens).
 *
 * It carries its ops inline rather than an id into a project-level library,
 * which is the one shape difference from the other two: a timeline and a class
 * set are reused across a site, while an op list is one or two fields long and
 * belongs to the element that writes it.
 */
export interface ActionBinding {
  id: string
  trigger: InteractionTrigger
  ops: ActionOp[]

  breakpoints?: string[]
}

export interface ElementNode {
  id: string
  type: string
  content?: string

  classes?: string
  interactions?: InteractionBinding[]
  animations?: AnimationBinding[]
  actions?: ActionBinding[]

  attributes?: Record<string, string>
  htmlId?: string
  src?: string

  svg?: string

  variants?: Record<string, string>

  variantClasses?: Record<string, string>

  hidden?: boolean

  /** editor-only: the Layers eye. Not rendered on the Edit canvas, ignored by
   * Play and the export. */
  editorHidden?: boolean

  slot?: boolean

  channel?: string

  background?: string
  locales?: Record<
    string,
    {
      content?: string
      src?: string

      attributes?: Record<string, string>
    }
  >
  link?: string
  arg?: string

  ref?: string
  entryId?: string

  listQuery?: {
    limit?: number

    offset?: number
    sortField?: string
    sortDir?: 'asc' | 'desc'
    filter?: ListFilter

    /** further conditions, ANDed with `filter` and with each other */
    filters?: ListFilter[]
    pick?: string[]

    excludeCurrent?: boolean
  }

  fieldAttrs?: Record<string, string>

  /** a draft scope: the inputs under it collect values for a `create` op */
  draft?: string

  instanceAttributes?: Record<string, string>

  slider?: SliderConfig

  form?: FormConfig
  children: ElementNode[]
}

export interface FormConfig {
  enabled?: boolean
  name?: string
  notify?: boolean
  forward?: boolean

  redirect?: string

  externalAction?: string
}

export interface SliderConfig {
  arrows?: boolean
  dots?: boolean

  perView?: Record<string, number>
  gap?: number
  autoplay?: boolean
  delay?: number
  loop?: boolean
  drag?: boolean
}

export interface Breakpoint {
  id: string
  name: string
  width: number
  height: number
}

export interface Page {
  id: string
  name: string
  path: string
  status: string
  elements: ElementNode[]
  collectionId?: string
  seo?: { title?: string; description?: string }

  customCode?: { head?: string; body?: string }

  createdAt?: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}

export interface CollectionField {
  id: string
  name: string
  type:
    | 'text'
    | 'number'
    | 'boolean'
    | 'select'
    | 'image'
    | 'date'
    | 'reference'
    | 'multi-reference'
    | 'multi-image'
  refCollectionId?: string

  options?: string[]

  /** a select's human labels, value → label. The VALUE is what pages match on,
   *  so renaming a label never restyles an entry; `data-field="status|label"`
   *  is what renders the words. */
  optionLabels?: Record<string, string>

  localize?: boolean
}

export interface CollectionEntry {
  id: string
  name: string
  slug: string

  values: Record<string, string | string[]>
  locales?: Record<string, Record<string, string>>

  status?: string

  seo?: { title?: string; description?: string }
  createdAt: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}

export interface Collection {
  id: string
  name: string
  fields: CollectionField[]
  templatePageId: string
  entries: CollectionEntry[]

  detailRoutes?: boolean

  routeBase?: string
}

export interface CommentReply {
  id: string
  text: string

  author: string
  authorId?: string
  createdAt: number
}

export interface CommentAnchor {
  nodeId: string
  rx: number
  ry: number
  breakpointId?: string | null
}

export interface Comment {
  id: string
  pageId: string
  anchor?: CommentAnchor
  breakpointId?: string | null
  x?: number
  y?: number
  text: string
  author: string
  authorId?: string
  resolved: boolean
  createdAt: number
  replies: CommentReply[]
}

export interface VariantAxis {
  name: string
  options: string[]
  default: string
}

export interface ComponentDef {
  id: string
  name: string
  root: ElementNode
  category?: string

  variants?: VariantAxis[]
}

/** a 301: a path the site used to answer on, and where it goes now */
export interface SiteRedirect {
  id: string
  from: string
  to: string
}

export interface DesignToken {
  id: string
  name: string
  value: string

  /** the dark-mode value; absent means this colour is the same in both modes */
  dark?: string
}

export type PublishMethod = 'server' | 'zip' | 'github'

export type StructuredDataType = 'Organization' | 'Person' | 'LocalBusiness'

export interface StructuredDataSettings {
  type: StructuredDataType
  sameAs?: string[]
  custom?: string
}

export interface ProjectSettings {
  favicon?: string
  faviconDark?: string

  publishing: {
    method: PublishMethod
    github: { repo: string; branch: string }
    apiOrigin?: string
  }
  seo: {
    siteName: string
    titleTemplate: string
    description: string
    ogImage?: string
    logo?: string
    schema?: StructuredDataSettings
  }
  domain: string

  smtp?: { host: string; port: string; user: string; password: string; from: string }
  integrations?: {
    stripe: { publishableKey: string }
    mailing: { provider: string }
  }
  tokens: DesignToken[]

  /** 301s, served by the node host and shipped as stubs for a static one */
  redirects?: SiteRedirect[]

  theme?: {
    rootFontSize?: string
    spacing?: string
    text?: Record<string, string>
    leading?: Record<string, string>
    tracking?: Record<string, string>
    radius?: Record<string, string>

    /** what a first-time visitor gets, before they have chosen (default light) */
    colorMode?: 'light' | 'dark' | 'system'
  }

  /**
   * Client-side entry state. `persist` decides whether an action's writes
   * outlive the page that made them: `session` (the default) is what lets a
   * status set on a task route show in the right column on the board, `none`
   * forgets on every load, `local` survives the browser being closed.
   */
  state?: {
    persist?: 'none' | 'session' | 'local'
  }

  motion?: {
    appearMode?: 'once' | 'replay' | 'reverse'

    transitions?: {
      enabled: boolean

      preset?: string
      duration?: number
      easing?: string
      exitAnimationId?: string
      enterAnimationId?: string
    }

    scroll?: { enabled: boolean; lerp?: number }
  }
  customCode: { head: string; body?: string }
  fonts: {
    family: string
    monoFamily?: string
    serifFamily?: string
    googleFontsUrl?: string

    custom?: CustomFont[]
  }
}

export interface CustomFont {
  id: string
  family: string
  src: string
  format?: string
  weight?: string
  style?: 'normal' | 'italic'
}

export interface Project {
  id: string
  name: string

  schemaVersion?: number
  pages: Page[]
  components: ComponentDef[]
  collections: Collection[]
  interactions: Interaction[]
  animations: Animation[]

  effects?: Effect[]
  breakpoints: Breakpoint[]
  comments: Comment[]
  locales: string[]
  defaultLocale: string
  settings: ProjectSettings
}
