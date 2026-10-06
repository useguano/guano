import type { Plugin } from 'vite'

/**
 * Prepend the MIT licence line to a built runtime.
 *
 * `server/site-runtime.js` is hand-written and carries the line in source;
 * `motion-runtime.js` and `slider-runtime.js` are minified build output, so
 * without this they shipped — embedded verbatim in every exported site — with
 * no licence statement a reader of the file could see, while
 * LICENSE-EXCEPTIONS.md is what carves them out of the AGPL.
 *
 * A plugin rather than `rollupOptions.output.banner`: the minifier drops the
 * banner (even in the `/*!` legal-comment form), and `generateBundle` runs
 * after it.
 */
const LINE =
  '// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)'

export function mitBanner(): Plugin {
  return {
    name: 'guano:mit-banner',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') file.code = `${LINE}\n${file.code}`
      }
    },
  }
}
