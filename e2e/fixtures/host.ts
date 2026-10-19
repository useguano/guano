import { expect, type Page } from '@playwright/test'

/**
 * The host half of the bridge: records what the page posts, nothing else.
 * Install before the first navigation.
 */
export async function fakeHost(page: Page) {
  await page.addInitScript(() => {
    const posts: unknown[] = []
    Object.defineProperty(window, '__hostPosts', { value: posts })
    Object.defineProperty(window, 'webkit', {
      value: {
        messageHandlers: {
          superbird: {
            postMessage: (message: unknown) => {
              posts.push(message)
              // ...and ANSWER the one message the page blocks on. The router
              // guard asks the host to mint a builder session whenever this
              // page does not hold one, and `requestReauth` waits for
              // `sessionRestored` or `sessionLost` — so a host that only
              // records would make every navigation sit out the bridge's
              // timeout before continuing. The real app answers both ways;
              // this one says it cannot, which is a host with no secret.
              const type = (message as { type?: string } | null)?.type
              if (type !== 'unauthorized') return
              queueMicrotask(() => {
                const host = (
                  window as unknown as { __superbirdHost?: { sessionLost?: (why?: string) => void } }
                ).__superbirdHost
                host?.sessionLost?.('this fake host mints nothing')
              })
            },
          },
        },
      },
    })
  })
}

export const hostPosts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __hostPosts: unknown[] }).__hostPosts)

/**
 * The Edit / Play switch is the HOST's button (the launcher's header), so a
 * test switches the way the launcher does: through `__superbirdHost.setViewMode`.
 * Waits for the page to post the mode back, which is what the host's label
 * reads.
 */
export async function hostViewMode(page: Page, mode: 'build' | 'preview') {
  await page.evaluate((next) => {
    const host = (window as unknown as { __superbirdHost?: { setViewMode: (m: string) => void } })
      .__superbirdHost
    if (!host) throw new Error('no host callbacks: install fakeHost() before navigating')
    host.setViewMode(next)
  }, mode)
  await expect
    .poll(async () => {
      const sent = (await hostPosts(page)) as { type: string; mode?: string }[]
      return sent.filter((m) => m.type === 'view-mode').at(-1)?.mode
    })
    .toBe(mode)
}
