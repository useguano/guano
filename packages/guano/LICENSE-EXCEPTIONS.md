# Licensing

Guano is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0-only) — see [LICENSE](LICENSE) — with the exceptions below.

## Your exported sites are yours

The static sites Guano exports are **your content, not ours**. The AGPL applies
to Guano itself (the editor, the server, the MCP tools), never to the HTML,
CSS, media, or data it produces for you. No license obligation of any kind
attaches to a site you build and publish with Guano.

## The embedded runtimes are MIT

Every exported site embeds a few small scripts — the interaction runtime
(`assets/script.js`), on pages that animate the motion runtime
(`assets/motion.js`), and on pages with a slider the carousel runtime
(`assets/slider.js`). So that no copyleft question can ever touch a published
site, these files and their sources are licensed under the **MIT License**,
not the AGPL:

- `server/site-runtime.js` (the interaction runtime, embedded as `assets/script.js`)
- `server/motion-runtime.js` (the built motion runtime, embedded as `assets/motion.js`)
- `server/slider-runtime.js` (the built carousel runtime, embedded as `assets/slider.js`)
- `src/motion/runtime.ts` and `src/slider/runtime.ts` (those runtimes' sources)
- `src/lib/shared/motion.js`, `src/lib/shared/scroll.js`,
  `src/lib/shared/slider.js` and `src/lib/shared/interactionClasses.js`
  (shared logic bundled into the runtimes)

MIT License — Copyright (c) 2026 Francois Lemieux

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## In plain terms

- **Self-hosting Guano** (for yourself or for clients): no obligations.
- **Publishing sites built with Guano**: no obligations, ever.
- **Modifying Guano and offering it to others over a network** (e.g. a hosted
  Guano service): you must make your modified source available to those users,
  per the AGPL.
