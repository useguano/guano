// MCP runtime entry point.
//
// The `guano mcp` subcommand (packages/guano/mcp/) runs in plain Node and needs
// the SAME structure/style logic the browser editor uses — the HTML reader and
// identity-carrying writer, the tree and component ops, the element registry,
// and class application. Those live
// in TypeScript under src/lib/. Rather than port them (and risk drift), this
// file re-exports exactly the functions the MCP server calls; a Vite lib build
// (vite.mcp.config.ts) bundles this module + its transitive deps into a single
// DOM-free ESM file at packages/guano/runtime/mcp-runtime.mjs.
//
// INVARIANT: everything reachable from here must be free of Vue and browser
// globals. styleCatalog.ts was refactored to hold icon *names* (not lucide
// components) precisely so applyClass can be bundled here. If you add a re-export
// that drags in Vue/DOM, refactor the import graph — do not externalize it.

// --- list sources that are not collections (`@pages`)
export { BUILTIN_LIST_SOURCES } from './nodeState'

// --- the v2 schema migration (src/lib/migrate.ts). The SERVER runs this over
// every project blob in the store at boot — Main, the drafts, the guano-base
// merge snapshots and the published baseline — so nothing is left on v1.
export { migrateProject, describeMigration, SCHEMA_VERSION } from './migrate'
export type { MigrationReport } from './migrate'

// components: instance detection, name normalization, master adoption, and
// the realign that carries per-instance state across a structure change
export {
  isComponentType,
  normalizeComponentName,
  adoptStructure,
  alignStructure,
  cloneForMaster,
  stripExtractedInstanceState,
} from './components'
export type { AdoptResult, OrphanedNode } from './components'

// whole-project component operations. Pure and DOM-free, so the agent path
// runs the editor's own code instead of a copy that has to be kept in step.
export {
  pushMasterStructure,
  alignMirrors,
  // the verbs the Components drawer offers a human — rename, duplicate,
  // regroup, detach, delete — so an agent is not left with a smaller set
  setComponentMeta,
  componentUsage,
  renameComponent,
  duplicateComponent,
  setComponentCategory,
  detachInstance,
  deleteComponent,
} from './componentOps'

// --- the agent-facing HTML layer (src/lib/html/) — the read, the strict
// reader, and the write that carries node identity. Nothing in the editor
// imports it, so the parser never enters the browser bundle.
export {
  pageToHtml,
  masterToHtml,
  parseHtml,
  applyHtml,
  contextFromProject,
  tagForType,
  typeForTag,
  sameType,
  shortIds,
  nodesByShortId,
  ELIDED_DATA_URL,
  MAX_INPUT,
  MAX_DEPTH,
} from './html'
export type {
  HtmlMode,
  SerializeOptions,
  ParsedNode,
  ParseError,
  ParseResult,
  ApplyResult,
  ApplyOptions,
  Refusal,
} from './html'

// --- structure validation, over the tree (src/lib/validateTree.ts)
export { validateTree } from './validateTree'
export type { TreeDiagnostic, ValidateContext } from './validateTree'

// --- url slug normalization, shared with the exporter's route paths
export {
  slugify,
  // the route table a publish warning needs: every internal link has to land
  // on a route the export actually emits
  entryRoutePath,
  collectionRouteBase,
  hasDetailRoutes,
} from './shared/slug.js'

// --- element registry + node factory (src/lib/elements.ts)
export {
  ELEMENTS,
  createNode,
  isKnownElement,
  isLeafElement,
  isInstancePart,
  typeOptionsFor,
} from './elements'
export type { ElementDef } from './elements'

// --- tree helpers (src/lib/tree.ts)
export { walkNodes, findNode, findParent, hasAncestorOfType, deepClone } from './tree'

// --- class application + validation (src/lib/styles.ts)
// setStyleTokens feeds the project's design-token names into the (module-level)
// class vocabulary so bg-<token>/text-<token>/border-<token> validate — the MCP
// toolset calls it on every project load, mirroring useSettings' watcher
export {
  applyClass,
  isValidClass,
  matchClass,
  sameProperty,
  isStateClass,
  setStyleTokens,
} from './styles'
export type { ApplyClassResult, StyleProperty, StyleSection } from './styles'
export { STYLE_SECTIONS } from './styleCatalog'

// --- rich-text sanitizer + URL allowlists (src/lib/shared/, plain JS) — the
// content tool stores element text through the SAME sanitizer the editor and
// the static exporter use, and gates media src on the same scheme allowlist
export { isRich, sanitizeRich } from './shared/richtext.js'
export { SAFE_HREF, SAFE_SRC } from './shared/urls.js'
// --- structured data (seo.schema) validator, shared with the exporter
export { customSchemaError } from './shared/structuredData.js'

// inline SVG for the `:icon:` element — the sanitizer every renderer trusts.
// The icon TABLE is deliberately not re-exported: it is the whole Lucide set,
// and the tools import it on demand (see loadIcons in mcp/tools.mjs)
export { sanitizeInlineSvg, lucideSvg, lucideNameOf, MAX_SVG_BYTES } from './shared/svg.js'

// variants: picks → classes. The exporter takes `effectiveClasses` from this
// bundle too — it needs the full style catalog, which is TypeScript
export { effectiveClasses, pickedKeys, variantKey, VARIANT_NAME_RE } from './variants'
export {
  addVariantAxis,
  renameVariantAxis,
  removeVariantAxis,
  addVariantOption,
  renameVariantOption,
  removeVariantOption,
  setVariantDefault,
  setVariantAxes,
  setInstancePick,
  setVariantClasses,
} from './variantOps'
export { mergeClassLayers, sameLayerProperty } from './styles'

// component instances — the one pairing walk, and the chain it resolves
export {
  buildInstanceMap,
  canNest,
  componentReaches,
  dependencyOrder,
  nestedComponentNames,
  isInstanceWrapper,
  resolvePicks,
  resolveInstanceValue,
  inheritedInstanceValue,
  isNodeHidden,
  setNodeHidden,
} from './shared/instances.js'

// --- custom attribute allowlist (src/lib/shared/attributes.js) — the MCP
// sanitizes attributes with the SAME allowlist the editor and exporter use
export {
  sanitizeAttributes,
  isAllowedAttribute,
  isLocalizableAttribute,
  mergeAttributeLayers,
  resolveNodeAttributes,
} from './shared/attributes.js'

// which nodes a route renders under an entry scope — the publish check for a
// binding whose target it can never reach (see shared/entryScope.js)
export { buildScopeRoots, isEntryScopeRoot } from './shared/entryScope.js'

// --- per-locale SEO purge (src/lib/shared/locales.js) — page/project SEO
// overrides live outside the node `locales` buckets, so removing a locale has
// to clear them too, identically in the editor and here
export { purgeLocaleSeo, countLocaleSeo } from './shared/locales.js'

// --- design-token validation (src/lib/shared/tokens.js) + settings defaults
export {
  isValidToken,
  isEmittableToken,
  isReservedToken,
  tokenError,
  TOKEN_NAME_RE,
  HEX_RE,
  RESERVED_TOKEN_NAMES,
  isThemeValue,
} from './shared/tokens.js'

// --- custom webfonts (src/lib/shared/fonts.js) — agents register fonts as
// data, NOT as hand-written @font-face in customCodeHead (head code is
// exporter-only, so those fonts never render in the editor or preview)
export { fontError, fontFormatForUrl, FONT_FORMATS } from './shared/fonts.js'

// motion engine — the validators and vocabulary agents need to author
// animations, plus the compiler so a tool can report a timeline's length.
// DOM-free by construction (see src/lib/shared/motion.js).
export {
  MOTION_PROPS,
  EASINGS,
  EASING_KEYS,
  compileAnimation,
  validateAnimation,
  validateBinding,
  countTargetError,
  APPEAR_MODES,
  validateMotionSettings,
  TRANSITION_PRESET_IDS,
  TRANSITION_DEFAULTS,
  SCROLL_LERP_MIN,
  SCROLL_LERP_MAX,
} from './shared/motion.js'
export { defaultSettings } from './settings'

// --- slider (carousel) config — validated against the SAME rules the editor's
// Data panel writes through, so an agent can't author a config the UI refuses
export {
  SLIDER_DEFAULTS,
  validateSliderConfig,
  resolveSliderConfig,
  // the carousel chrome's own words — translatable like any other attribute
  // text, which is what makes the worklist and the publish warning see them
  sliderLabelAttributes,
} from './shared/slider.js'
// forms: the config validator (edit_elements {form}) and the field reader the
// publish warnings use — the same functions the Data panel and the exporter run
export { collectFormFields, formConfigError, formEnabled, formName } from './shared/forms.js'
export {
  fieldValueError,
  fieldNameError,
  isTranslatableType,
  RESERVED_FIELD_NAMES,
} from './collectionFields'

// --- interaction key identity + vocabulary (src/lib/shared/interactionKeys.js).
// The MCP validates bindings against the SAME trigger/action lists the editor,
// exporter and published runtime use — and state being keyed by
// (interaction, target) rather than by binding is what makes an open button and
// a close button drive one effect, so agents can build modals at all.
export {
  INTERACTION_ACTIONS,
  INTERACTION_CLOSE_ON,
  INTERACTION_ONCE,
  INTERACTION_TRIGGERS,
  DEFAULT_SCROLL_AT,
  interactionStateKey,
  interactionGroupKey,
  isSymmetricTrigger,
  CHANNEL_NAME_RE,
  channelName,
  channelTargetId,
  isChannelName,
  isChannelTarget,
} from './shared/interactionKeys.js'

// --- channels (src/lib/shared/channels.js): a target that is a NAME, so one
// overlay can be opened from anywhere in the project. The tools need the
// listener index to answer "does anything listen on @start?" before accepting
// a binding, and the per-route counts for the `channel-declared-twice` warning.
export { buildChannelIndex, channelListeners, routeChannelCounts } from './shared/channels.js'

// --- project/page factories (src/lib/factories.ts) — create_page mirrors the
// editor, and createProject lets the SERVER seed a fresh instance's Main blob
// so a headless install doesn't wait for somebody to open /admin in a browser
export { createBody, createPage, createProject, defaultBreakpoints } from './factories'

// --- shared element/node types (compile-time only; erased at runtime)
export type { ElementNode } from '@/types/editor'
