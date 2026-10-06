/**
 * The agent-facing HTML layer.
 *
 * Agents read and write pages as a strict HTML subset, because it is a format
 * every model already knows, and because one write then carries structure,
 * classes and text together — the indentation DSL it replaces needed a
 * structure call and then a second round of element edits.
 *
 * `serialize` is the read (canonical, deterministic, the thing the page
 * `version` hashes), `parse` the reader (strict, with `line:col` on every
 * refusal), `apply` the write (identity carried by `data-id`, then `data-ref`,
 * then a tree LCS). Nothing in the editor imports any of it: the parser never
 * enters the browser bundle.
 */
export { pageToHtml, masterToHtml, ELIDED_DATA_URL } from './serialize'
export type { HtmlMode, SerializeOptions } from './serialize'
export { parseHtml, decodeEntities, MAX_INPUT, MAX_DEPTH } from './parse'
export type { ParsedNode, ParseError, ParseResult } from './parse'
export { applyHtml, contextFromProject } from './apply'
export type { ApplyResult, ApplyOptions, Refusal } from './apply'
export { tagForType, typeForTag, sameType, ALIAS_OF, isLeafType } from './tags'
export { shortIds, nodesByShortId } from './ids'
