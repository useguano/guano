// Process lifecycle: in-flight accounting, critical-section tracking and a
// graceful shutdown.
//
// Why this exists. Nothing here handled a signal, so `docker stop` or a systemd
// restart killed the process wherever it happened to be. The expensive case is
// a publish: server/export.mjs builds into a staging directory and then renames
// it over the live one, and a kill landing between those two renames left NO
// live site at all — every visitor got "Nothing published yet" until someone
// published again. Store writes are tmp+rename so a file is never torn, but a
// whole-project PUT cut mid-flight still loses the work the caller thought it
// had saved.
//
// So a stop now means: stop accepting, let the work that is already running
// finish, then exit. Two deadlines rather than one, because a request and an
// export are different obligations — a big site genuinely takes longer than
// any sane request timeout, and cutting it is precisely what strands a staging
// directory.
import { log } from './log.mjs'

/** how long to keep answering health checks as "stopping" before the socket
 * closes, so an orchestrator can take us out of rotation first. 0 by default:
 * only a load balancer needs it. */
const GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS) || 0
/** how long to wait for ordinary in-flight requests */
const DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS) || 10_000
/** how long to wait for a publish / export / restore to finish */
const CRITICAL_MS = Number(process.env.SHUTDOWN_CRITICAL_MS) || 30_000

let shuttingDown = false
let bootExitRequested = false
let signalCount = 0
let inflight = 0

/** { label, startedAt, promise } — a Set rather than a counter so the drain can
 * name what it is waiting on. An operator staring at a 30-second hang needs to
 * read "still waiting on publish (12s)", not a number. */
const critical = new Set()

export const isShuttingDown = () => shuttingDown

/** true when a signal arrived while boot() was still running */
export const exitRequestedDuringBoot = () => bootExitRequested

/** Count a request for the drain, tag it with an id, and write one access line
 * when it closes. `close` rather than `finish`: an aborted publish is exactly
 * the request the drain should still be accounting for. */
export function beginRequest(req, res, rid, ip) {
  req.rid = rid
  res.setHeader('x-request-id', rid)
  inflight++
  const startedAt = Date.now()
  let done = false
  res.on('close', () => {
    if (done) return
    done = true
    inflight--
    // pathname only — a query string is where the preview token and an unlock
    // `next` live, and an access log is the last place they should land
    const pathname = String(req.url ?? '/').split('?')[0]
    log.request(req.method, pathname, res.statusCode, Date.now() - startedAt, ip, rid)
  })
}

/** Run `fn` as a section a shutdown must not cut. */
export async function withCritical(label, fn) {
  const record = { label, startedAt: Date.now(), promise: null }
  const promise = (async () => fn())()
  record.promise = promise
  critical.add(record)
  try {
    return await promise
  } finally {
    critical.delete(record)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** poll `ready` until true or the deadline passes; log what we are waiting on
 * every 5s so a hang is legible rather than silent */
async function waitFor(label, ready, deadlineMs, describe) {
  const until = Date.now() + deadlineMs
  let announced = 0
  while (!ready() && Date.now() < until) {
    if (Date.now() - announced > 5_000) {
      announced = Date.now()
      log.info(`shutdown: still waiting on ${label}${describe ? ` — ${describe()}` : ''}`)
    }
    await sleep(100)
  }
  return ready()
}

const describeCritical = () =>
  [...critical]
    .map((r) => `${r.label} (${Math.round((Date.now() - r.startedAt) / 1000)}s)`)
    .join(', ')

/**
 * Install the signal handlers.
 *
 * `beforeClose` is not optional in practice: the SSE change feed holds
 * long-lived responses that never end on their own, so server.close() would
 * sit there for the whole deadline waiting on connections that are working
 * exactly as designed. The hook ends them first.
 */
export function installShutdown({ servers, beforeClose }) {
  const onSignal = (signal, signum) => {
    signalCount++
    if (signalCount > 1) {
      // someone is holding ctrl-c down, or an orchestrator escalated. Stop
      // pretending to be graceful and exit the way a killed process does.
      log.warn(`shutdown: second ${signal} — forcing exit`)
      process.exit(128 + signum)
      return
    }
    shuttingDown = true
    if (!servers.some((s) => s.listening)) {
      // still inside boot(): main() checks this and exits before listening,
      // which lets a migration finish its current blob rather than tearing
      // the store in half. migrateSchema is idempotent, so the next boot
      // picks up where this one stopped.
      bootExitRequested = true
      log.info(`shutdown: ${signal} during boot — will exit once the current step finishes`)
      return
    }
    void drain(signal)
  }

  const drain = async (signal) => {
    log.info(`shutdown: ${signal} — draining`)
    // health answers 503 from here on, while the socket is still open
    if (GRACE_MS) await sleep(GRACE_MS)

    try {
      await beforeClose?.()
    } catch (err) {
      log.warn(`shutdown: beforeClose failed: ${err.message}`)
    }

    for (const srv of servers) {
      srv.close()
      // keep-alive sockets sit idle forever otherwise, and close() never
      // resolves while one is open
      srv.closeIdleConnections?.()
    }

    const [requestsDone, criticalDone] = await Promise.all([
      waitFor('in-flight requests', () => inflight <= 0, DRAIN_MS, () => `${inflight} open`),
      waitFor('critical work', () => critical.size === 0, CRITICAL_MS, describeCritical),
    ])

    if (!criticalDone) log.error(`shutdown: gave up waiting on ${describeCritical()}`)
    else if (!requestsDone) log.warn(`shutdown: gave up waiting on ${inflight} open request(s)`)

    for (const srv of servers) srv.closeAllConnections?.()
    log.info(`shutdown: bye`)
    process.exit(requestsDone && criticalDone ? 0 : 1)
  }

  process.on('SIGTERM', () => onSignal('SIGTERM', 15))
  process.on('SIGINT', () => onSignal('SIGINT', 2))

  // An uncaught throw leaves the process in a state nothing here can reason
  // about, so draining through it would be worse than stopping. Log it
  // structured — which is more than the previous behaviour gave — and go.
  process.on('uncaughtException', (err) => {
    log.error(err, { fatal: 'uncaughtException' })
    process.exit(1)
  })
  // A stray rejection is NOT fatal here, deliberately: a long-lived
  // self-hosted instance should not die because one background fetch lost its
  // catch. It is logged loudly instead.
  process.on('unhandledRejection', (reason) => {
    log.error(reason instanceof Error ? reason : new Error(String(reason)), {
      fatal: 'unhandledRejection',
    })
  })
}
