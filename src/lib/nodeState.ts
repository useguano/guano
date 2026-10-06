/**
 * List sources that are not collections: `@pages` iterates the site's own
 * published pages. The `@` prefix is reserved, so it can never collide with a
 * collection someone named "pages".
 *
 * This file is what is left of `syntax.ts` after the indentation DSL was
 * deleted. It also held `NODE_STATE_KEYS` / `hasNodeState` / `stripNodeState`,
 * an enumeration of "the state the code cannot express, which `reconcile` had
 * to carry across a reparse". Nothing reads it any more, and the comment that
 * claimed it was still "the state a write preserves on every element it
 * adopts" was false: `applyHtml` preserves that state by REUSING the node
 * object, so there is no list to keep in step — which is exactly why the old
 * one kept drifting. A write's `fresh` path empties the body and lets every
 * node be created clean, which needs no enumeration either.
 */
export const BUILTIN_LIST_SOURCES = ['@pages']
