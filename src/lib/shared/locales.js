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

export function countLocaleSeo(project, code) {
  let n = 0
  for (const page of project.pages ?? []) if (page.seo?.locales?.[code]) n++
  if (project.settings?.seo?.locales?.[code]) n++
  return n
}
