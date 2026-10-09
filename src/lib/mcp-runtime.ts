export { BUILTIN_LIST_SOURCES } from './nodeState'

export { migrateProject, describeMigration, SCHEMA_VERSION } from './migrate'
export type { MigrationReport } from './migrate'

export {
  isComponentType,
  normalizeComponentName,
  adoptStructure,
  alignStructure,
  cloneForMaster,
  stripExtractedInstanceState,
} from './components'
export type { AdoptResult, OrphanedNode } from './components'

export {
  pushMasterStructure,
  alignMirrors,
  setComponentMeta,
  componentUsage,
  renameComponent,
  duplicateComponent,
  setComponentCategory,
  detachInstance,
  deleteComponent,
} from './componentOps'

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

export { validateTree } from './validateTree'
export type { TreeDiagnostic, ValidateContext } from './validateTree'

export {
  slugify,
  entryRoutePath,
  collectionRouteBase,
  hasDetailRoutes,
} from './shared/slug.js'

export {
  ELEMENTS,
  createNode,
  isKnownElement,
  isLeafElement,
  isInstancePart,
  typeOptionsFor,
} from './elements'
export type { ElementDef } from './elements'

export { walkNodes, findNode, findParent, hasAncestorOfType, deepClone } from './tree'

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

export { isRich, sanitizeRich } from './shared/richtext.js'
export { SAFE_HREF, SAFE_SRC } from './shared/urls.js'
export { customSchemaError } from './shared/structuredData.js'

export { sanitizeInlineSvg, lucideSvg, lucideNameOf, MAX_SVG_BYTES } from './shared/svg.js'

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

export {
  sanitizeAttributes,
  isAllowedAttribute,
  isLocalizableAttribute,
  mergeAttributeLayers,
  resolveNodeAttributes,
} from './shared/attributes.js'

export { buildScopeRoots, isEntryScopeRoot } from './shared/entryScope.js'

export { purgeLocaleSeo, countLocaleSeo } from './shared/locales.js'

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

export { fontError, fontFormatForUrl, FONT_FORMATS } from './shared/fonts.js'

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

export {
  SLIDER_DEFAULTS,
  validateSliderConfig,
  resolveSliderConfig,
  sliderLabelAttributes,
} from './shared/slider.js'
export { collectFormFields, formConfigError, formEnabled, formName } from './shared/forms.js'
export {
  fieldValueError,
  fieldNameError,
  isTranslatableType,
  RESERVED_FIELD_NAMES,
} from './collectionFields'

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

export { buildChannelIndex, channelListeners, routeChannelCounts } from './shared/channels.js'

export { createBody, createPage, createProject, defaultBreakpoints } from './factories'

export type { ElementNode } from '@/types/editor'
