// Per-locale SEO lives OUTSIDE the node/entry `locales` buckets that every
// other translation uses: page overrides sit at `page.seo.locales[code]` and the
// project defaults at `settings.seo.locales[code]`. Removing a locale used to
// purge only the buckets, so these survived as strings for a language that no
// longer renders — and nothing in the editor or the MCP surface could reach them
// afterwards to clean up.
//
// Shared verbatim by useLocale.deleteLocale (editor) and the MCP's
// purgeLocaleOverrides, so a locale removal means the same thing on both.

/** delete a locale's SEO overrides everywhere, pruning emptied containers so a
 *  touch-then-clear leaves the blob byte-identical (keeps merge signatures
 *  stable, same rule as node/entry overrides) */
export function purgeLocaleSeo(project, code) {
  for (const page of project.pages ?? []) {
    const seo = page.seo
    if (!seo?.locales?.[code]) continue
    delete seo.locales[code]
    if (!Object.keys(seo.locales).length) delete seo.locales
    if (!Object.keys(seo).length) delete page.seo
  }
  const settingsSeo = project.settings?.seo
  if (settingsSeo?.locales?.[code]) {
    delete settingsSeo.locales[code]
    if (!Object.keys(settingsSeo.locales).length) delete settingsSeo.locales
  }
}

/** how many SEO overrides a locale holds (one per page bucket, one for the
 *  project bucket) — so a removal refusal counts what it would really destroy */
export function countLocaleSeo(project, code) {
  let n = 0
  for (const page of project.pages ?? []) if (page.seo?.locales?.[code]) n++
  if (project.settings?.seo?.locales?.[code]) n++
  return n
}
