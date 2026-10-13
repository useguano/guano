// Native light/dark switching.
//
// The mode has to be decided BEFORE THE FIRST PAINT, which is the whole reason
// this is a feature rather than a recipe: a class interaction with
// `once: "local"` restores the visitor's choice from `/assets/script.js`, a
// deferred script, so a dark-mode visitor got a full paint of the light site
// and then a flash to dark on every single navigation. Nothing an author can
// write in the editor runs early enough — only markup in `<head>` does.
//
// A blocking inline script also buys the state a class toggle cannot express:
// stored "light", stored "dark", and NOTHING STORED, which is what makes
// "follow the visitor's system until they choose" possible. An interaction has
// two states (fired, not fired), so with the OS in dark a click to go light
// fell back to dark and read as a broken toggle — which is why `dark:` stayed
// class-based (DARK_VARIANT in prose.js) and why the three-state answer had to
// live here instead.
//
// A switcher is a node's `link`, exactly like the language switcher's
// `@locale:<code>`: one existing field, no new schema, usable on any element,
// and it emits `data-guano-theme` instead of an `href` because a theme switch
// is not a navigation.

export const COLOR_MODE_KEY = 'guano-theme'

/** the reserved attribute the head script delegates clicks from */
export const COLOR_MODE_ATTR = 'data-guano-theme'

/** what a first-time visitor gets, before they have chosen anything */
export const COLOR_MODE_DEFAULTS = ['light', 'dark', 'system']

/** what a switcher does: flip, or pin one mode, or hand it back to the system */
export const COLOR_MODE_ACTIONS = ['toggle', 'light', 'dark', 'system']

export const THEME_LINK_PREFIX = '@theme'

/**
 * The switcher action a node's `link` declares, or null.
 * `@theme` is the toggle; `@theme:dark` / `:light` / `:system` pin a choice.
 */
export function themeLinkAction(link) {
  const raw = typeof link === 'string' ? link : ''
  if (raw === THEME_LINK_PREFIX) return 'toggle'
  if (!raw.startsWith(`${THEME_LINK_PREFIX}:`)) return null
  const action = raw.slice(THEME_LINK_PREFIX.length + 1)
  return COLOR_MODE_ACTIONS.includes(action) ? action : null
}

/** true for any `@theme…` link, including a misspelled action */
export function isThemeLink(link) {
  const raw = typeof link === 'string' ? link : ''
  return raw === THEME_LINK_PREFIX || raw.startsWith(`${THEME_LINK_PREFIX}:`)
}

export function defaultColorMode(settings) {
  const mode = settings?.theme?.colorMode
  return COLOR_MODE_DEFAULTS.includes(mode) ? mode : 'light'
}

/**
 * The resolved mode for a visitor who has stored `stored` (or nothing), under
 * a site default and a system preference. One function so the head script, the
 * Play surface and the tests cannot disagree about precedence: an explicit
 * choice always wins, and `system` is only consulted when there is none.
 */
export function resolveColorMode(stored, defaultMode, systemDark) {
  if (stored === 'dark' || stored === 'light') return stored
  const def = COLOR_MODE_DEFAULTS.includes(defaultMode) ? defaultMode : 'light'
  if (def === 'system') return systemDark ? 'dark' : 'light'
  return def
}

/** the mode a switcher action lands on, given the mode showing now */
export function nextColorMode(action, current) {
  if (action === 'toggle') return current === 'dark' ? 'light' : 'dark'
  return action === 'light' || action === 'dark' ? action : null
}

/**
 * The inline `<head>` script: resolve the mode, put it on <html> before the
 * first paint, and delegate every switcher click.
 *
 * It is self-contained on purpose. `/assets/script.js` ships only for routes
 * that have interactions or a form, so a theme switcher on an otherwise static
 * route would have no runtime at all — and anything deferred is a flash by
 * construction. ES5, no optional chaining: it runs before everything, so it
 * must never be the thing that throws.
 *
 * `colorScheme` goes on the element too, so the native scrollbars, form
 * controls and `light-dark()` values match the mode rather than the OS.
 */
export function colorModeScript(defaultMode) {
  const def = COLOR_MODE_DEFAULTS.includes(defaultMode) ? defaultMode : 'light'
  return (
    '(function(){try{' +
    `var K=${JSON.stringify(COLOR_MODE_KEY)},D=${JSON.stringify(def)},` +
    'd=document.documentElement,' +
    "mq=window.matchMedia?matchMedia('(prefers-color-scheme: dark)'):null," +
    "get=function(){try{var v=localStorage.getItem(K);return v==='dark'||v==='light'?v:null}catch(e){return null}}," +
    "res=function(){var s=get();return s?s:(D==='system'?(mq&&mq.matches?'dark':'light'):D)}," +
    "put=function(m){d.classList.remove('dark','light');d.classList.add(m);d.style.colorScheme=m};" +
    'put(res());' +
    'if(mq&&mq.addEventListener)mq.addEventListener("change",function(){if(!get())put(res())});' +
    "document.addEventListener('click',function(e){" +
    'var t=e.target;' +
    "if(!t||!t.closest)return;t=t.closest('[" + COLOR_MODE_ATTR + "]');if(!t)return;" +
    'e.preventDefault();' +
    `var a=t.getAttribute('${COLOR_MODE_ATTR}')||'toggle';` +
    "if(a==='system'){try{localStorage.removeItem(K)}catch(e){}}" +
    "else{var m=a==='toggle'?(d.classList.contains('dark')?'light':'dark'):a;" +
    'try{localStorage.setItem(K,m)}catch(e){}}' +
    'put(res());' +
    '},true)' +
    '}catch(e){}})()'
  )
}
