/**
 * Was this navigation ours?
 *
 * A leaf module on purpose: `useUnloadGuard` reads the flag but pulls in
 * `usePersistence` (and through it the whole project document) to do its job,
 * while the two writers — logout in `useAuth`, the 401 bounce in `lib/store` —
 * need nothing but the flag. Keeping it here is what lets the store set it
 * with a plain import: importing the guard itself would close the cycle
 * store → guard → persistence → store, which is why that call used to be a
 * dynamic import that the bundler could not honour anyway (`useAuth` imports
 * the same module statically, so nothing ever moved out of the chunk).
 */
let leaving = false

/** a navigation WE started — logout, or the 401 bounce. There is nothing to
 * warn about: the first has already flushed, and the second cannot save
 * anything on a dead session, so a prompt would only be in the way. */
export function beginDeliberateNavigation() {
  leaving = true
}

export function isDeliberateNavigation() {
  return leaving
}
