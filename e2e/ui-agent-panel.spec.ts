import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'
import {
  AGENT_BUSY_TURN,
  AGENT_DENIAL,
  AGENT_HARNESS_DENIAL,
  AGENT_HARNESS_TURN,
  AGENT_ASK_DENIAL,
  AGENT_ASK_ONE,
  AGENT_ASK_TURN,
  AGENT_INIT,
  AGENT_INIT_SONNET,
  AGENT_INTERRUPT_RESULT,
  AGENT_RATE_LIMITED,
  AGENT_READY,
  AGENT_STEP_IN_FLIGHT,
  AGENT_SUGGEST_TURN,
  AGENT_TURN,
  agentReplay,
} from './fixtures/agentStream'

// The AI panel's builder half (ROADMAP §5 step 1), driven entirely through a
// FAKE host: the real one is a SwiftUI app spawning `claude`, so the only
// thing testable here — and the only thing worth testing — is that the page
// speaks the bridge protocol and that the reducer renders the recorded wire
// correctly.
//
// The panel is the left rail's first button and a docked 16rem column, so
// "open" is `useViewMode`'s one `column` ref — which is what makes the last
// case (one column at a time) an assertion about the invariant rather than
// about two components agreeing.
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

const railButton = (page: Page) => page.getByRole('button', { name: 'Ask the AI agent' })

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

    // it is the rail's FIRST button: before Pages, after the logo
    await expect(railButton(page)).toBeVisible()
    const order = await page.evaluate(() => {
      const rail = document.querySelector('aside')
      return [...(rail?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label'))
    })
    expect(order.filter((label) => label !== 'App').slice(0, 2)).toEqual([
      'Ask the AI agent',
      'Pages',
    ])
  })

  // Panel-first: the button is gated on the host having ANSWERED, not on the
  // answer being yes. Hiding it left the feature undiscoverable on exactly the
  // machines that needed the install instructions. A browser, where nothing
  // answers, still has no button — that is the first case above.
  test('a host with no Claude Code still gets the button, and the install guide', async ({ page }) => {
    await feed(page, [{ type: 'unavailable', reason: 'Claude Code is not installed' }])
    await expect(page.locator('[data-agent-button]')).toBeVisible()
    await page.locator('[data-agent-button]').click()
    const guide = page.locator('[data-agent-install]')
    await expect(guide).toBeVisible()
    await expect(guide).toContainText('npm install -g @anthropic-ai/claude-code')
    await expect(page.locator('[data-agent-retry]')).toBeVisible()
    // "stopped" is a different sentence and keeps the terse restart strip
    await feed(page, [{ type: 'unavailable', reason: 'the agent exited (code 1)' }])
    await expect(page.locator('[data-agent-install]')).toHaveCount(0)
    await expect(page.locator('[data-agent-status]')).toContainText('exited')
  })

  test('the branch the editor has open is posted to the host, after agent-start', async ({ page }) => {
    // The host WAITS for this rather than defaulting to Main: an agent in the
    // panel never picks a target, so a lost message must look like the bug it
    // is.
    await expect
      .poll(async () => {
        const sent = (await posts(page)) as { type: string; target?: string }[]
        const start = sent.findIndex((m) => m.type === 'agent-start')
        const target = sent.findIndex((m) => m.type === 'agent-target')
        return start !== -1 && target > start ? sent[target]!.target : null
      })
      .toBe('main')

    // ...and again after a `ready`: a reload replays `agent-start`, and the
    // host dropped what it knew along with the page that told it
    const before = ((await posts(page)) as { type: string }[]).filter(
      (m) => m.type === 'agent-target',
    ).length
    await feed(page, [AGENT_READY, AGENT_INIT])
    await expect
      .poll(async () =>
        ((await posts(page)) as { type: string }[]).filter((m) => m.type === 'agent-target').length,
      )
      .toBe(before + 1)
  })

  test('switching the branch names it and holds the composer', async ({ page }) => {
    await readyPanel(page)
    await feed(page, [{ type: 'switching', target: 'main' }])
    const strip = page.locator('[data-agent-switching]')
    await expect(strip).toBeVisible()
    await expect(strip).toContainText('Switching the agent to Main')
    await expect(page.locator('[data-agent-input]')).toBeDisabled()

    await feed(page, [AGENT_READY, AGENT_INIT])
    await expect(page.locator('[data-agent-switching]')).toHaveCount(0)
    await expect(page.locator('[data-agent-input]')).toBeEnabled()
  })

  test('on Main with the policy off, an admin is offered the switch', async ({ page }) => {
    await page.route('**/api/agent-policy', async (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({ json: { allowMainWrites: true, allowPublish: false } })
      }
      return route.fulfill({ json: { allowMainWrites: false, allowPublish: false } })
    })
    // no reload needed: the drawer asks for the policy when it MOUNTS, which
    // is the first time the panel is opened
    await readyPanel(page)

    const notice = page.locator('[data-agent-main-notice]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText("The AI can't edit Main yet")
    // the same setting Settings → MCP flips, reachable where the refusal is
    await page.locator('[data-agent-allow-main]').click()
    await expect(notice).toHaveCount(0)
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
    // the page is named the way the TOOLS take it — `pageId` resolves either
    // way now, and the path alone cost the first embedded session two calls
    expect(sent[0]!.text).toMatch(/pageId: \S+, path: \//)

    // the question shows immediately, dimmed until the host echoes it back
    await expect(page.locator('[data-agent-question]')).toHaveText('make the heading say Hello')
    await expect(page.locator('[data-agent-question]')).toHaveClass(/opacity-50/)
    await feed(page, [agentReplay('Context…\n\nmake the heading say Hello')])
    await expect(page.locator('[data-agent-question]')).not.toHaveClass(/opacity-50/)
  })

  test('a recorded turn renders one question, one activity bubble and the answer ONCE', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('make the heading say Hello')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('Context…\n\nmake the heading say Hello'), ...AGENT_TURN])

    // trap 7: the echoed question is OURS — rendering it again would double it
    await expect(page.locator('[data-agent-question]')).toHaveCount(1)
    await expect(page.locator('[data-agent-turn]')).toHaveCount(1)

    // tool calls live in a collapsed bubble, described in words, not as names
    const activity = page.locator('[data-agent-activity]')
    await expect(activity).toHaveCount(1)
    await expect(activity).toHaveAttribute('data-agent-activity-count', '1')
    await expect(activity).toHaveAttribute('data-agent-activity-state', 'done')
    await expect(activity).toContainText('Wrote home')
    await expect(page.locator('[data-agent-tool]')).toHaveCount(0)
    await activity.getByRole('button').click()
    await expect(page.locator('[data-agent-tool]')).toHaveCount(1)
    await expect(page.locator('[data-agent-tool]')).toHaveAttribute('data-agent-tool-state', 'done')

    // The answer is streamed at block index 1 (after a thinking block) and
    // then consolidated ALONE at array index 0. Keying by array index drew
    // every paragraph twice — the first bug a real session showed.
    const texts = page.locator('[data-agent-text]')
    await expect(texts).toHaveCount(1)
    await expect(texts).toHaveText('The heading now reads Hello.')

    await expect(page.locator('[data-agent-error]')).toHaveCount(0)
    await expect(page.locator('[data-agent-step]')).toHaveCount(0)
  })

  test('consecutive tool calls collapse into one bubble between the sentences', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('build it')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('build it'), ...AGENT_BUSY_TURN])

    await expect(page.locator('[data-agent-text]')).toHaveCount(2)
    const activity = page.locator('[data-agent-activity]')
    await expect(activity).toHaveCount(1)
    await expect(activity).toHaveAttribute('data-agent-activity-count', '3')
    await expect(activity).toContainText('3 steps')
    await expect(activity).toContainText('Listed the pages')
    await activity.getByRole('button').click()
    await expect(page.locator('[data-agent-tool]').nth(0)).toContainText('Read the guide: page-html')
  })

  test('harness bookkeeping is neither a step nor a row', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('what pages are there')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('what pages are there'), ...AGENT_HARNESS_TURN])

    // two ToolSearch calls and one real one: the bubble counts the real one
    const activity = page.locator('[data-agent-activity]')
    await expect(activity).toHaveCount(1)
    await expect(activity).toHaveAttribute('data-agent-activity-count', '1')
    await expect(activity).toContainText('1 step')
    await expect(activity).toContainText('Listed the pages')
    await activity.getByRole('button').click()
    await expect(page.locator('[data-agent-tool]')).toHaveCount(1)
    await expect(page.locator('[data-agent-panel]')).not.toContainText('ToolSearch')
  })

  test('a DENIED harness tool is still shown — hidden is not silent', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('read my notes')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('read my notes'), ...AGENT_HARNESS_DENIAL])

    const activity = page.locator('[data-agent-activity]')
    await expect(activity).toHaveAttribute('data-agent-activity-state', 'error')
    await activity.getByRole('button').click()
    const tool = page.locator('[data-agent-tool]')
    await expect(tool).toHaveAttribute('data-agent-tool-state', 'denied')
    await expect(tool).toContainText('not allowed in this panel')
  })

  // (a) One question is answered by the click itself: there is nothing to
  // collect, so the chip sends, with the page context, exactly once.
  test('one question: a chip click sends the label, with the context, once', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('a coming soon page')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('a coming soon page'), ...AGENT_ASK_ONE])

    const chips = page.locator('[data-agent-ask] [data-agent-chip]')
    await expect(chips).toHaveCount(2)
    await chips.first().click()

    const sent = (await posts(page)).filter((m) => (m as { type: string }).type === 'agent-send') as {
      text: string
    }[]
    expect(sent).toHaveLength(2)
    expect(sent[1]!.text).toContain('Stark editorial')
    expect(sent[1]!.text).toContain('Context from the Guano editor')
    // the picked chip stays highlighted, and a later turn makes them inert —
    // which is also what stops a second click sending a second message
    await expect(chips.first()).toHaveAttribute('data-agent-chip-picked', '')
    await expect(chips.first()).toHaveAttribute('data-agent-chip-inert', '')
    await expect(chips.first()).toBeDisabled()
  })

  // (b) Several questions go through the ONE composer. There is no second send
  // button in this app (docs/ui.md), so the arrow is the thing that has to wait
  // for the batch to be complete.
  test('two questions: the arrow waits for both, then sends one message', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('a coming soon page for Acme')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('a coming soon page for Acme'), ...AGENT_ASK_TURN])
    const before = ((await posts(page)) as { type: string }[]).filter((m) => m.type === 'agent-send').length

    await expect(page.locator('[data-agent-input]')).toHaveAttribute(
      'placeholder',
      'Pick above, or type an answer',
    )
    await expect(page.locator('[data-agent-send]')).toBeDisabled()

    const chips = page.locator('[data-agent-ask] [data-agent-chip]')
    await chips.nth(0).click() // direction → Stark editorial
    // one of two is not an answer
    await expect(page.locator('[data-agent-send]')).toBeDisabled()
    await chips.nth(3).click() // sections → Hero + work + contact
    await expect(page.locator('[data-agent-send]')).toBeEnabled()
    await page.locator('[data-agent-send]').click()

    const sent = (await posts(page)).filter((m) => (m as { type: string }).type === 'agent-send') as {
      text: string
    }[]
    expect(sent).toHaveLength(before + 1)
    const text = sent[sent.length - 1]!.text
    expect(text).toContain('Q: Which direction? → Stark editorial')
    expect(text).toContain('Q: What should it carry? → Hero + work + contact')
    // ONE message, both lines, and the bubble says the same thing the wire did
    await expect(page.locator('[data-agent-question]').last()).toContainText('Q: Which direction?')
  })

  // (c) Chips are not a cage: the composer stays live and a typed message
  // answers in place of them.
  test('typed text answers instead of the chips', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('a coming soon page for Acme')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('a coming soon page for Acme'), ...AGENT_ASK_TURN])

    await page.locator('[data-agent-input]').fill('neither — copy the look of our app')
    await expect(page.locator('[data-agent-send]')).toBeEnabled()
    await page.locator('[data-agent-send]').click()

    const sent = (await posts(page)).filter((m) => (m as { type: string }).type === 'agent-send') as {
      text: string
    }[]
    const text = sent[sent.length - 1]!.text
    expect(text).toContain('neither — copy the look of our app')
    // a half-picked batch is not an answer, so no Q lines ride along
    expect(text).not.toContain('Q: Which direction?')
  })

  // (d) The offer comes AFTER the recap, a click sends the suggestion's own
  // prompt verbatim, and the chips are inert for the rest of the transcript.
  test('a suggestion sends its prompt, and goes inert in the next turn', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('build it')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('build it'), ...AGENT_SUGGEST_TURN])

    const suggest = page.locator('[data-agent-suggest]')
    await expect(suggest.locator('[data-agent-chip]')).toHaveCount(3)
    // after the recap, not before it
    const order = await page.evaluate(() => {
      const turn = document.querySelector('[data-agent-turn]')!
      return [...turn.querySelectorAll('[data-agent-text],[data-agent-suggest]')].map((el) =>
        el.hasAttribute('data-agent-suggest') ? 'suggest' : 'text',
      )
    })
    expect(order).toEqual(['text', 'suggest'])

    await suggest.locator('[data-agent-chip]').first().click()
    const sent = (await posts(page)).filter((m) => (m as { type: string }).type === 'agent-send') as {
      text: string
    }[]
    expect(sent[sent.length - 1]!.text).toContain(
      'Add a subtle load animation: the heading and the form fade and rise in, staggered.',
    )

    // kept, dimmed, the picked one highlighted — the transcript still reads as
    // what was offered and what was taken
    const chips = suggest.locator('[data-agent-chip]')
    await expect(chips.first()).toHaveAttribute('data-agent-chip-picked', '')
    for (let i = 0; i < 3; i++) await expect(chips.nth(i)).toBeDisabled()
  })

  test('chips are inert while a turn runs, so a click cannot fire twice', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('build it')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('build it'), ...AGENT_SUGGEST_TURN])
    const chip = page.locator('[data-agent-suggest] [data-agent-chip]').first()
    await expect(chip).toBeEnabled()

    // the send the click makes puts the panel straight back into a turn
    await chip.click()
    await expect(chip).toBeDisabled()
    const after = ((await posts(page)) as { type: string }[]).filter((m) => m.type === 'agent-send').length
    await chip.click({ force: true })
    expect(((await posts(page)) as { type: string }[]).filter((m) => m.type === 'agent-send').length).toBe(after)
  })

  // (e) An ask is CONVERSATION, not work. If it lands in the activity bubble as
  // "1 step · Ask user", the reducer opened it as a tool from
  // `content_block_start` — which is why the id is registered there, before
  // anything can reach `upsertTool` with it.
  test('an ask is not a step, and its result is consumed in silence', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('a coming soon page for Acme')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('a coming soon page for Acme'), ...AGENT_ASK_TURN])

    await expect(page.locator('[data-agent-ask]')).toHaveCount(1)
    // no bubble at all: the ask was the only tool call in the turn
    await expect(page.locator('[data-agent-activity]')).toHaveCount(0)
    await expect(page.locator('[data-agent-panel]')).not.toContainText('ask_user')
    await expect(page.locator('[data-agent-text]')).toHaveText('Two things before I start.')
  })

  test('a suggestion is not a step either — the build beside it is', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('build it')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('build it'), ...AGENT_SUGGEST_TURN])

    // the page write counts; the offer does not
    const activity = page.locator('[data-agent-activity]')
    await expect(activity).toHaveCount(1)
    await expect(activity).toHaveAttribute('data-agent-activity-count', '1')
    await expect(activity).toContainText('1 step')
    await expect(page.locator('[data-agent-suggest]')).toHaveCount(1)
  })

  test('a DENIED ask is a denied tool row — a denial is never hidden', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('ask me something')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('ask me something'), ...AGENT_ASK_DENIAL])

    await expect(page.locator('[data-agent-ask]')).toHaveCount(0)
    const activity = page.locator('[data-agent-activity]')
    await expect(activity).toHaveAttribute('data-agent-activity-state', 'error')
    await activity.getByRole('button').click()
    const tool = page.locator('[data-agent-tool]')
    await expect(tool).toHaveAttribute('data-agent-tool-state', 'denied')
    await expect(tool).toContainText('not allowed in this panel')
  })

  test('the strip above the composer says what the agent is doing right now', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('style it')
    await page.locator('[data-agent-send]').click()
    const strip = page.locator('[data-agent-step]')
    await expect(strip).toContainText('Thinking')
    await feed(page, AGENT_STEP_IN_FLIGHT)
    await expect(strip).toContainText('Read the guide: styling')
    await expect(page.locator('[data-agent-activity]')).toHaveAttribute('data-agent-activity-state', 'running')
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

    const activity = page.locator('[data-agent-activity]')
    await expect(activity).toHaveAttribute('data-agent-activity-state', 'error')
    await activity.getByRole('button').click()
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
    await expect(page.locator('[data-agent-activity]')).toHaveAttribute('data-agent-activity-state', 'done')
  })

  test('the model menu switches the session and shows what came back', async ({ page }) => {
    await readyPanel(page)
    const trigger = page.locator('[data-agent-model] button').first()
    await expect(trigger).toContainText('Opus 5')
    await trigger.click()
    await page.locator('[data-agent-model-choice="sonnet"]').click()
    const switched = (await posts(page)).some(
      (m) => (m as { type: string; model?: string }).type === 'agent-model' && (m as { model?: string }).model === 'sonnet',
    )
    expect(switched).toBe(true)

    // set_model is answered by a fresh init naming the new model
    await feed(page, [AGENT_INIT_SONNET])
    await expect(trigger).toContainText('Sonnet 5')
  })

  test('an attached image travels as an image block beside the text', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-file]').setInputFiles({
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not really a png'),
    })
    await expect(page.locator('[data-agent-attachments] img')).toHaveCount(1)
    await page.locator('[data-agent-input]').fill('match this')
    await page.locator('[data-agent-send]').click()

    const sent = (await posts(page)).filter((m) => (m as { type: string }).type === 'agent-send') as {
      text: string
      images?: { mediaType: string; data: string }[]
    }[]
    expect(sent).toHaveLength(1)
    expect(sent[0]!.images).toHaveLength(1)
    expect(sent[0]!.images![0]!.mediaType).toBe('image/png')
    expect(sent[0]!.images![0]!.data).toBe(Buffer.from('not really a png').toString('base64'))
    await expect(page.locator('[data-agent-attachments]')).toHaveCount(0)
    await expect(page.locator('[data-agent-turn] img')).toHaveCount(1)
  })

  test('one column at a time, and the chat survives being closed', async ({ page }) => {
    await readyPanel(page)
    await page.locator('[data-agent-input]').fill('make the heading say Hello')
    await page.locator('[data-agent-send]').click()
    await feed(page, [agentReplay('Context…\n\nmake the heading say Hello'), ...AGENT_TURN])

    // Pages and the chat are the same `column` ref, so opening one closes the
    // other by the type rather than by two components agreeing
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
    await expect(page.locator('[data-agent-panel]')).toHaveCount(0)

    // the transcript is composable state, not the drawer's: it comes back
    await railButton(page).click()
    await expect(page.locator('[data-agent-text]')).toHaveText('The heading now reads Hello.')
  })

  test('the chat is reachable in Play, where the dock never was', async ({ page }) => {
    await readyPanel(page)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.locator('[data-agent-panel]')).toBeVisible()
    await expect(page.locator('[data-agent-input]')).toBeVisible()
  })
})
