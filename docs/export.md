# Publish & export: the exporter, the fx wire format, caching, methods, preview

**`SAFE_HREF`/`SAFE_SRC` refuse a backslash anywhere** (`src/lib/shared/urls.js`, imported by both renderers, the exporter and the agent layer). Per the WHATWG URL parser a `\` is a `/` for every special scheme, so an author-written `/\evil.example` passed as "root-relative" and navigated to `https://evil.example`. That is not a privilege gain — the same author may write the absolute url — but it defeats everything downstream that reads `/…` as internal: the locale prefix, `aria-current`, the dead-link check, and a reviewer skimming the link. `isInternalRoute`, the redirects `PATH_RE` and the site-password `next` already refused it; this was the one allowlist that did not.

<!-- Read this before touching server/export.mjs, a site runtime, or anything
     under server/ that ships bytes to a visitor. CLAUDE.md points here. -->

## The exporter

Publishing (`POST /api/published`, admin/editor only) writes a project snapshot, then runs `server/export.mjs` — a pure-JS static-site exporter, no Vue, that mirrors `useRenderNode`. It:

- renders the page's body node as the real `<body>` tag (its classes/id/interactions/background go on the tag; layout/colour/font defaults live in an `@layer base` rule so body utilities always override),
- extracts data-URL media to hashed files under `assets/media/`,
- compiles Tailwind via `@tailwindcss/node`,
- emits per-route HTML, `/assets/style.css`, `/assets/script.js` (the interaction runtime, `server/site-runtime.js`), `/assets/motion.js` (the tween runtime, emitted only for routes that animate) and `/assets/slider.js` (only for routes with a slider) into `server/data/site`.

`handleStatic` serves that for every non-`/admin` path. The export is fully portable — root-absolute URLs, deployable to any static host. Unpublished pages are dropped. The exporter shares the element and token registries with the client through `src/lib/shared/`.

There is no `GET /api/published`. `DELETE /api/published` (session, admin/editor — **never** an agent token) **unpublishes**: it removes `site/` and `published.json`, so visitors get "Nothing published yet." until the next publish, and `usePublish.unpublish` forgets the baseline and info keys so the next publish reads as a first one (Settings → Publish → Status → Unpublish).

## `site-runtime.js` never touches `.className`

It reads and writes a class list with `getAttribute`/`setAttribute('class')`. On an `<svg>`, `.className` is a read-only `SVGAnimatedString` — and the throw happened while BUILDING the target list, so one interaction aimed at an `icon` (a chevron flip) killed every interaction on the route. Both Vue renderers bind `class` the Vue way and were fine, which is what made it invisible until the published page. Coverage: `e2e/interactions.spec.ts`.

## The effects wire format is COMPILED, not serialized

`src/lib/shared/fxWire.js` is the one definition, read by the exporter and both site runtimes.

The published page carries **one `data-fx="<n>"` per participating element** and **one `<script type="application/json" id="guano-fx">` manifest**. That replaces four escaped-JSON attributes per element (`data-int`/`data-anim`/`data-tgt`/`data-atgt`) and seven JSON islands (`int-fx`, `int-fxrm`, `int-fxbp`, `int-bp`, `int-modal`, `anim-lib`, `anim-bp`, `site-fx`). `data-fx` is an index into the manifest's `els`, whose entry holds all four roles at once: `c` the class effects it fires, `m` the timelines it triggers, `t` the state keys driving its class list, `a` the binding keys whose tween lands on it.

Three things make it a compile rather than a rename.

**Every key is interned to a route-local ordinal** by `ctx.intern` — one table per route, with a prefix per kind so a play key can never collide with a binding key (the motion runtime keys a play by `meta.s || meta.k`). The editor keys an effect by uuid because `interactionId:targetId@scope` has to mean something across pages, components, undo and a 3-way merge; on a published route a key's only job is to match a trigger to its listener. Serializing the uuids cost **23.5% of the exported HTML in identifier characters** — 1,049 occurrences of 389 distinct uuids on one real page. **Every key-producing site must go through the table.** The one that did not — the channel ANIMATION listener, which pushed `binding.id` raw — shipped a key the trigger side no longer matched: a channel-opened tween that landed nowhere, with publish reporting success. A zero-uuid scan of the artifact is what caught it.

**The payload moved off the elements**, which took 2,700 `&quot;` sequences (13.5 KB of pure escaping) and the per-component-instance duplication with it — six FeatureCards carried the same two-binding shape six times.

**`stripTimeline`** reduces a library entry to the fields `compileAnimation` actually reads. The stored `animation.id`/`name` and every `step.id` are uuid the browser parses and throws away (−39% on a 70-timeline page). It omits a default rather than writing it, because the compiler resolves an absent field to the same value — but it tests `!== undefined` for `from`/`to`, which are legitimately `0` and, for a count, legitimately absent.

Measured on the real project: **161 KB → 109 KB raw, gzip 28.8 → 15.7 KB**, zero uuids left in the artifact.

**`check:corpus` cannot referee a change like this** — it diffs exported bytes, and every byte moved — so the **behavioural specs are the contract**: `interactions`, `site-motion`, `export-channel`, `export-repeat-bindings`, `export-mouse-follow`, `export-forms` and the slider/locale/image specs drive the published page in a real browser. They read the format through ONE helper (`e2e/fixtures/fxWire.ts`) rather than six ad-hoc regexes, and they assert **relationships** — "the key this trigger declares is one some element listens on" — because the published ids are ordinals with no meaning outside the file. That is stronger than the uuid literal it replaced: the bug class these guard has always been a key the trigger writes and the listener never hears.

## Image performance hints

**Every exported `<img>` carries hints the canvas never sees** — the one documented exception to the three-renderers rule, because they change no pixel:

- intrinsic `width`/`height` from `sizeFor` (`export-media.mjs`: the library index's recorded size, else a `sharp` header read of the bytes being interned — neither name is in `ATTR_ALLOW`, so there is nothing to conflict with),
- `decoding="async"`,
- **one eager image per route** — the FIRST `<img>` in document order gets `fetchpriority="high"` and no `loading`, every later one `loading="lazy"`. A hero is one image, and `fetchpriority` on several is worse than on none.

An authored `loading` wins, and the exporter then emits none of its own, since a duplicate attribute resolves to the first occurrence.

`width`/`height` are safe **only** because the exported stylesheet carries Tailwind's preflight `img,video{max-width:100%;height:auto}`. Without it they would DISTORT every `w-full` image, so `e2e/export-images.spec.ts` asserts the rule beside the attributes.

## Responsive variants

`srcsetFor`: every intern'd `jpg`/`png`/`webp` is also written at 480/768/1200/1600 px as `assets/media/<hash>-<w>.webp`, filtered to the widths SMALLER than the original (upscaling is worse than letting the browser take the full file), and offered as `srcset`.

**A GIF is excluded** — it may be animated, and a resize would flatten it to one frame. So are SVG (it scales by itself) and AVIF (already smaller than the webp we would make). `src` stays the original, so a browser without `srcset` and an image too small to resize both still work.

`sizes` is the one thing the export cannot know — the layout decides the slot — so it is in `ATTR_ALLOW` for the author and defaults to `100vw`, which over-fetches rather than shipping a blurry image.

Resizing is **cached** under `$GUANO_DATA_DIR/media/variants/<hash>-<w>.webp`: the content hash already names the original, so the key is free, and a republish (and the preview export, which runs the same code and shares the cache) reads instead of re-encoding. An unwritable cache warns and costs time, never the export.

## The published site is cacheable, in three tiers

`cacheHeaders`, beside `serveSiteDir`. It used to send no cache headers at all — no `cache-control`, no `etag`, nothing to revalidate against — so under the `server` method every navigation re-downloaded `script.js` (24 KB), `motion.js` (17 KB), `style.css` (32 KB) and every image on the page.

The tiers are decided by whether a URL can ever change meaning.

- **`assets/media/<sha>…` is content-addressed**, so that URL is immutable by construction: `max-age=31536000, immutable`, never revalidated. These are the biggest files a site ships.
- **Everything else keeps its name across a republish** — the HTML, `style.css`, the three runtimes — so it is `no-cache` (meaning "ask every time", not "don't store") plus an ETag, and `serveSiteDir` answers the conditional request with a **304**. That is the load-bearing half: without it the header costs a sha256 per request and saves nothing.
- **A private site is `private`** on both tiers, because the visitor password is a real access control and `public` would let a proxy hand the page to someone who never typed it.

**The preview server is `no-store` with no ETag at all** — it renders drafts, and a stale draft in any cache is worse than a slow one.

Zip and GitHub exports are served elsewhere and get the host's own headers; the `server` method IS the host, which is why this is its problem. Coverage: `e2e/store-site-cache.spec.ts`.

## Publish methods

`settings.publishing.method`, chosen in Settings → Publish and captured at mount by `PublishDialog`. Every method exports once — so the local site at `/` always refreshes — via `POST /api/published?method=server|zip|github`.

**`server`** responds with JSON stats.

**`zip`** streams the freshly-exported `site/` back as an attachment: a hand-rolled zero-dep writer in `server/zip.mjs` (`createZip`/`readZip` on `node:zlib` + CRC32, zip-slip guarded), **with every root-absolute URL rewritten depth-relative** (`server/relative.mjs` — `assets/style.css` at the root, `../assets/style.css` one level down, and a route link `/fr` becomes `../fr/index.html`, so the archive opens from disk and from a sub-folder). `//cdn`, `/_guano/*`, `data-form-redirect`, JSON-LD and `<meta content>` are left alone. The directory on disk, what `/` serves and what GitHub receives all keep `/assets/…`.

**`github`** pushes the export as the **complete tree** of a branch via the GitHub Git Data API (`server/github.mjs`, global `fetch`, replace-root so deleted routes and assets disappear). The **token is server-side only** — stored in `server/data/publish.json`, never `/api/store`, never the project blob, never an export — and managed write-only via `GET/PUT /api/publish-config` (`{github:{tokenSet}}`, which never echoes it). The **repo and branch come from the stored Main blob, never the request body**: the server signs the push with its own PAT, so letting the caller name the destination would delegate that PAT's write access to anyone who can publish.

All non-server methods require admin/editor, **enforced before the export runs** rather than just documented, and publishes are rate-limited per user.

**Every download is named by the server** — `<project slug>_<8 hex>.zip` from `exportFilename()` for the site zip, the project backup and a snapshot download, and a snapshot is given that name at creation too. The client reads it off `content-disposition` via `filenameFrom` (`lib/download.ts`) rather than spelling one itself.

## Where a statically hosted site reaches the instance

`settings.publishing.apiOrigin`. The `server` method IS this host, so it needs nothing; a zip or GitHub export is served elsewhere and bakes the studio's public origin into every form `action`.

Validated as an `https:` origin with no path (`http:` only for localhost) in the panel AND at export, which falls back to a root-relative action rather than emitting a broken one. It sits in `settings.publishing`, which `protectedFieldDelta` already refuses to contributors and agent tokens, so an injected agent cannot redirect a site's submissions.

The public namespace's CORS rule (`server/public/cors.mjs`) reads the allowed origin from the **published snapshot**, not the live blob — a draft must not be able to open the endpoint to any domain — matches it rather than reflecting it, and never allows credentials.

## Private site

`GET/PUT /api/site-password`, session + build role; Settings → General → Private site. One shared visitor password, scrypt-hashed in `publish.json` beside an `enabled` switch, never in the project blob.

`siteGateHandled` sits in front of `serveSiteDir(SITE)` and answers with an inline gate page (401, noindex, no-store) until a `POST /_guano/unlock` (form, 10/min per IP) sets the `guano_site` cookie — an HMAC of the stored hash, so a new password logs every visitor out. Enforced by this server only: zip and GitHub exports are static files and stay public. Minimum 8 characters.

Three details are load-bearing. The unlock limiter keys on **`clientIp`** — it was the one limiter ignoring `TRUST_PROXY`, so behind a proxy ten wrong guesses locked every visitor out. The redirect rejects `\` as well as `//`, because a browser treats `/\` as `//` for a special scheme (`site-runtime.js` already had the rule). And the comparison runs through the async, concurrency-capped verify rather than blocking the loop per guess. Coverage: `e2e/store-site-password.spec.ts`.

## Preview without publishing

`POST /api/preview` → `handlePreview` in `server/index.mjs`. It runs the same `exportSite` into `server/data/preview` and serves it **from this same server, under `/_guano/preview/`**.

It renders **draft pages too** (the live export drops them), sends `X-Robots-Tag: noindex`, and is deliberately NOT gated on the agent publish policy: seeing your own work should never require shipping it. A contributor's snapshot goes through the same `mergeContributorProject` as a publish, so a preview cannot render structure they may not write. Its own rate limit (30/min) means looking never spends the publish budget. `serveSiteDir` is the shared static handler for the live site and the preview, and takes a `mount` it strips before the file lookup.

MCP exposes it as the `preview` tool; the review session that prompted this published six of seven times purely to look. Coverage: `e2e/store-preview.spec.ts`.

## It used to be a second server on `PORT + 1`

That is the thing to understand before changing any of this. The export emits **root-absolute** URLs (`/assets/style.css`, `/fr`), so a sub-path would have meant threading a base path through every emitted URL — and a separate port sidesteps that.

What the separate port cost: it bound every interface and authenticated nothing (so every unpublished draft was public on any host without a firewall), spoke plain HTTP while the studio is HTTPS, needed its own token gate, its own rate-limit buckets and its own form handler, and **behind a proxy or on a VPS it was simply unreachable** — so the `preview` tool handed back a url that hangs, and the one workflow it exists for ("open it and look") could never run. `previewLink` built `http://${req.headers.host}:${previewPort}/`, which off localhost is a port nothing forwards.

**`mountSite` (`server/relative.mjs`) is what replaced it**: one pass over the exported HTML and CSS moving every root-absolute URL onto the mount, run on the files on disk inside the same `withCritical('preview')` section as the export. A preview is exported once and then browsed, so the cost is paid once.

Three paths are deliberately NOT rewritten, because they are the instance's and not the site's: `//cdn…`, anything under `/_guano/` and anything under `/media/`. The one exception is the form endpoint, remapped from `/_guano/forms/:id` into `<mount>/forms/:id` so a draft form posts to the preview's own handler — it validates exactly as the live one does and then stores and sends nothing. Without that remap, trying out a form in the preview would put a row in the real list. `data-form-redirect` is rewritten too (the zip rewrite leaves it alone), or a form's success redirect would send you to the LIVE route of that name.

**The signed `?t=` token stays, even though the session cookie now reaches here.** Same origin removed the reason it couldn't be the credential (the cookie is `Secure`, the preview was plain HTTP elsewhere) — but the agent's BROWSER is a different browser profile with no Guano session at all, and opening the link is how it gets the short-TTL cookie that every later asset request, click and screenshot rides on. A session-only gate would mean the one workflow this exists for is the one that cannot run. The cookie's `Path` is the mount, so it is never sent to the published site, the editor or the API.

`/_guano/preview` without its trailing slash answers a 302 to the slashed form: without it the browser resolves every relative URL one directory up.

`routePaths` on the export's return (and `routeUrls` on the API response and the `preview` tool) is every route's url, carrying the same token — so an agent navigates straight to a page instead of clicking around hunting for a link to it. Clicking is for checking navigation, not for reaching a page.

## Project package export/import

`GET /api/project-export` / `POST /api/project-import`, **admin-only**. `/api/snapshots` keeps the same package ON the server under `data/backups/<id>.zip` — take, list, download, restore, delete — through the shared `buildPackage` / `applyPackage`, surfaced as Settings → Snapshots.

The package is a `.zip` of `store/` + `media/`, never users, sessions, invites, `publish.json` or `site`. Import strict-allowlists every entry, requires a valid `manifest.json` and at least one project blob with pages, then atomically swaps the live `store`/`media` dirs and calls `resetMediaIndexCache()` so imported media is visible without a restart.

`readDirFiles` (`server/util.mjs`) is the shared recursive dir reader for zip/github/export; `readBodyRaw` (buffer) backs the import upload, capped at 512 MB.
