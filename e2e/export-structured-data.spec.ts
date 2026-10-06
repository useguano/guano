import { test, expect } from '@playwright/test'
import { mcpSession } from './fixtures/mcpSession'

// `seo.schema` turns on a schema.org JSON-LD block on every route: the site
// identity, a WebSite node and the route's WebPage. Custom JSON-LD rides
// along, with `<` escaped so it can never close the script tag.

test.describe('structured data', () => {
  test('nothing is emitted until it is turned on', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { domain: 'acme.test', seo: { siteName: 'Acme' } })
    const routes = await s.exportAll()
    expect(routes['index.html']).not.toContain('application/ld+json')
  })

  test('the graph carries identity, site and page, absolute against the domain', async () => {
    const s = await mcpSession()
    const r = await s.call('update_settings', {
      domain: 'acme.test',
      seo: {
        siteName: 'Acme',
        schema: {
          type: 'Organization',
          sameAs: ['https://x.com/acme', 'javascript:alert(1)'],
          custom: '{"@type":"Thing","name":"</script><b>"}',
        },
      },
    })
    expect(r.saved).toBe(true)
    const routes = await s.exportAll()
    const html = routes['index.html']
    const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)
    expect(m).toBeTruthy()
    const doc = JSON.parse(m![1])
    expect(doc['@context']).toBe('https://schema.org')
    const types = doc['@graph'].map((n: { '@type': string }) => n['@type'])
    expect(types).toEqual(['Organization', 'WebSite', 'WebPage', 'Thing'])
    const org = doc['@graph'][0]
    expect(org.name).toBe('Acme')
    expect(org.url).toBe('https://acme.test/')
    expect(org.sameAs).toEqual(['https://x.com/acme'])
    // the custom entry is in the graph but could not close the tag
    expect(m![1]).not.toContain('</script')
    expect(doc['@graph'][3].name).toBe('</script><b>')
  })

  test('invalid custom JSON-LD is refused with the reason', async () => {
    const s = await mcpSession()
    const r = await s.call('update_settings', {
      seo: { schema: { type: 'Person', custom: '{"name": "no type"}' } },
    })
    expect(r.saved).toBe(false)
    expect(r.reason).toBe('invalid-schema-custom')
  })
})
