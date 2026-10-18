import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'
import {
  AGENT_DENIAL,
  AGENT_INIT,
  AGENT_INTERRUPT_RESULT,
  AGENT_RATE_LIMITED,
  AGENT_READY,
  AGENT_TURN,
  agentReplay,
} from './fixtures/agentStream'

// The AI panel's builder half (ROADMAP §5 step 1), driven entirely through a
// FAKE host: the real one is a SwiftUI app spawning `claude`, so the only
// thing testable here — and the only thing worth testing — is that the page
// speaks the bridge protocol and that the reducer renders the recorded wire
// correctly.
//
// Four of these protect against a visibly wrong transcript that types cannot
// catch, each named in §5's trap 7 and step 0: the replayed question rendered
// twice, a blank bubble built from empty thinking deltas, an interrupt
// reported as a crash, and a denial that appears nowhere while the model asks
// for permission.
//
// Named to sort AFTER smoke.spec (docs/gates.md): this logs in.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

/** The host half of the bridge: records what the page posts, nothing else. */
async function fakeHost(page: Page) {
  await page.addInitScript(() => {
    const posts: unknown[] = []
    Object.defineProperty(window, '__hostPosts', { value: posts })
    Object.defineProperty(window, 'webkit', {
      value: { messageHandlers: { guano: { postMessage: (message: unknown) => posts.push(message) } } },
    })
  })
}

async function openEditor(page: Page) {
  await page.goto('/admin/')
  const projectName = page.getByPlaceholder('Project name')
  const email = page.getByPlaceholder('Email')
  const ready = page.getByRole('button', { name: 'Pages', exact: true })
  await expect(projectName.or(email).or(ready).first()).toBeVisible({ timeout: 30_000 })

  if (await projectName.isVisible()) {
    await projectName.fill('Smoke Co')
    await email.fill(ADMIN.email)
    await page.getByPlaceholder('Password (min. 8 characters)').fill(ADMIN.password)
    await page.getByPlaceholder('Confirm password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Setup project' }).click()
  } else if (await email.isVisible()) {
    await email.fill(ADMIN.email)
    await page.getByPlaceholder('Password', { exact: true }).fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
  await loadFixture(page)
  await expect(ready).toBeVisible({ timeout: 30_000 })
}

const posts = (page: Page) => page.evaluate(() => (window as unknown as { __hostPosts: unknown[] }).__hostPosts)

const feed = (page: Page, lines: unknown[]) =>
  page.evaluate((batch) => {
    const host = (window as unknown as { __guanoHost: { agentEvent: (e: unknown) => void } }).__guanoHost
    for (const line of batch) host.agentEvent(line)
  }, lines)

async function readyPanel(page: Page) {
  await feed(page, [AGENT_READY, AGENT_INIT])
  await page.locator('[data-agent-button]').click()
  await expect(page.locator('[data-agent-panel]')).toBeVisible()
}

test.describe('the AI panel', () => {
  test.beforeEach(async ({ page }) => {
    await fakeHost(page)
    await openEditor(page)
  })

  test('the button does not exist until the host answers, and boot asks it to', async ({ page }) => {
    // Posting agent-start at BOOT is load-bearing: `available` gates the
    // button, so a page that only asked on open could never be opened.
    await expect.poll(async () => (await posts(page)).some((m) => (m as { type: string }).type === 'agent-start')).toBe(
      true,
    )
    await expect(page.locator('[data-agent-button]')).toHaveCount(0)

    await feed(page, [AGENT_READY, AGENT_INIT])
    await expect(page.locator('[data-agent-button]')).toBeVisible()

    // the insert dock's own button is still there, beside it
    await expect(page.getByRole('button', { name: 'Insert elements', exact: true })).toBeVisible()
  })

  test('an unavailable host leaves no button and no panel', async ({ page }) => {
    await feed(page, [{ type: 'unavailable', reason: 'Claude Code was not found' }])
    await expect(page.locator('[data-agent-button]')).toHaveCount(0)
  })

  test('a send posts the typed text with the page context, once', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('make the heading say Hello')
    await page.locator('[data-agent-send]').click()

    const sent = (await posts(page)).filter((m) => (m as { type: string }).type === 'agent-send') as {
      text: string
    }[]
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('make the heading say Hello')
    expect(sent[0]!.text).toContain('Context from the Guano editor')

    // the question shows immediately, dimmed until the host echoes it back
    await expect(page.locator('[data-agent-question]')).toHaveText('make the heading say Hello')
    await expect(page.locator('[data-agent-question]')).toHaveClass(/opacity-50/)
    await feed(page, [agentReplay('Context…\n\nmake the heading say Hello')])
    await expect(page.locator('[data-agent-question]')).not.toHaveClass(/opacity-50/)
  })

  test('a recorded turn renders one question, one tool row and the answer', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('make the heading say Hello')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('Context…\n\nmake the heading say Hello'), ...AGENT_TURN])

    // trap 7: the echoed question is OURS — rendering it again would double it
    await expect(page.locator('[data-agent-question]')).toHaveCount(1)
    await expect(page.locator('[data-agent-turn]')).toHaveCount(1)

    const tool = page.locator('[data-agent-tool]')
    await expect(tool).toHaveCount(1)
    await expect(tool).toContainText('set_page_html')
    await expect(tool).toHaveAttribute('data-agent-tool-state', 'done')

    // trap 7: thinking deltas carry "" — a bubble built from them is blank
    const texts = page.locator('[data-agent-text]')
    await expect(texts).toHaveCount(1)
    await expect(texts).toHaveText('The heading now reads Hello.')

    await expect(page.locator('[data-agent-error]')).toHaveCount(0)
    await expect(page.locator('[data-agent-stop]')).toHaveCount(0)
  })

  test('Stop interrupts, and an interrupted turn is not reported as a crash', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('rewrite everything')
    await page.locator('[data-agent-send]').click()

    const stop = page.locator('[data-agent-stop]')
    await expect(stop).toBeVisible()
    await stop.click()
    expect((await posts(page)).some((m) => (m as { type: string }).type === 'agent-interrupt')).toBe(true)

    // step 0: an answered interrupt ends the turn with is_error and NO text
    await feed(page, [AGENT_INTERRUPT_RESULT])
    await expect(page.locator('[data-agent-turn]')).toContainText('Stopped.')
    await expect(page.locator('[data-agent-error]')).toHaveCount(0)
  })

  test('a denied tool says so, with the reason', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('save a note to disk')
    await page.locator('[data-agent-send]').click()
    await feed(page, AGENT_DENIAL)

    const tool = page.locator('[data-agent-tool]')
    await expect(tool).toHaveAttribute('data-agent-tool-state', 'denied')
    await expect(tool).toContainText('Write')
    await expect(tool).toContainText('granted')
  })

  test('a rejected rate limit is surfaced', async ({ page }) => {
    await readyPanel(page)
    await feed(page, [AGENT_RATE_LIMITED])
    await expect(page.locator('[data-agent-ratelimit]')).toContainText('out_of_credits')
  })

  test('a replay rebuilds the transcript after a reload', async ({ page }) => {
    // trap 8: the DOM is gone, the process is not. The host replays what it
    // streamed, and the question only exists in those isReplay lines.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeVisible({ timeout: 30_000 })
    await feed(page, [
      {
        ...AGENT_READY,
        replay: [AGENT_INIT, agentReplay('make the heading say Hello'), ...AGENT_TURN],
      },
    ])
    await page.locator('[data-agent-button]').click()
    await expect(page.locator('[data-agent-question]')).toHaveText('make the heading say Hello')
    await expect(page.locator('[data-agent-text]')).toHaveText('The heading now reads Hello.')
    await expect(page.locator('[data-agent-tool]')).toHaveAttribute('data-agent-tool-state', 'done')
  })

  test('only one dock panel is open at a time', async ({ page }) => {
    await readyPanel(page)
    await page.getByRole('button', { name: 'Insert elements', exact: true }).click()
    await expect(page.locator('[data-agent-panel]')).toHaveCount(0)
    await page.locator('[data-agent-button]').click()
    await expect(page.locator('[data-agent-panel]')).toBeVisible()
    await expect(page.locator('[data-dock-tab]')).toHaveCount(0)
  })
})
