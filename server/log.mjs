// Minimal structured logging. There is no logger dependency here on purpose —
// the same zero-dependency rule that gave us server/smtp.mjs and server/zip.mjs.
//
// The house style was already a subsystem prefix on a bare console call
// ('forms: retention prune failed: …'). This keeps that message text EXACTLY
// and only adds a timestamp, a level and optional JSON framing, so migrating a
// call site is a one-token rename and a reviewer can read the whole diff at a
// glance. Resist the urge to re-word messages while moving them.
//
// What an operator gets that they did not have: a timestamp on every line, a
// level they can turn down (LOG_LEVEL=warn silences the access log without
// silencing warnings), machine-readable output for a log shipper
// (LOG_JSON=1), and a request id that appears in the access line, in the
// error line and in the 500 response body — so a user's screenshot can be
// joined to a stack trace.
import { randomBytes } from 'node:crypto'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const LEVEL = LEVELS[String(process.env.LOG_LEVEL ?? 'info').toLowerCase()] ?? LEVELS.info
const JSON_OUT = process.env.LOG_JSON === '1'

/** 12 hex chars — short enough to read out over the phone, wide enough that
 * two live requests colliding is not a thing that happens. */
export function newRequestId() {
  return randomBytes(6).toString('hex')
}

/** An Error's message + stack, never the Error object itself: a raw Error
 * serializes `err.path` / `err.syscall`, which would put filesystem paths in a
 * log shipper. The publish catch in index.mjs already takes this care with the
 * response body; the log deserves the same. */
function describe(value) {
  if (value instanceof Error) return { msg: value.message, stack: value.stack }
  return { msg: String(value) }
}

function emit(level, args) {
  if (LEVELS[level] < LEVEL) return
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  const ts = new Date().toISOString()

  // a trailing plain object is treated as structured fields, not as a message
  let fields = null
  let parts = args
  const last = args[args.length - 1]
  if (args.length > 1 && last && typeof last === 'object' && !(last instanceof Error)) {
    fields = last
    parts = args.slice(0, -1)
  }

  const first = parts[0]
  const rest = parts.slice(1).map((p) => (p instanceof Error ? p.message : String(p)))
  const head = first instanceof Error ? describe(first) : { msg: String(first ?? '') }
  const msg = [head.msg, ...rest].filter(Boolean).join(' ')

  if (JSON_OUT) {
    const row = { ts, level, msg, ...(fields ?? {}) }
    if (head.stack) row.stack = head.stack
    stream.write(`${JSON.stringify(row)}\n`)
    return
  }

  const tail = fields
    ? ` ${Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`
    : ''
  stream.write(`${ts} ${level.padEnd(5)} ${msg}${tail}\n`)
  if (head.stack && level === 'error') stream.write(`${head.stack}\n`)
}

export const log = {
  debug: (...args) => emit('debug', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),

  /** One line per request, at info — so LOG_LEVEL=warn turns the access log off
   * without turning the warnings off, which is what a busy instance wants.
   * Only `pathname`: a query string is where tokens end up (the preview token,
   * an unlock `next`), and an access log is the last place they should land. */
  request(method, pathname, status, ms, ip, rid) {
    emit('info', [`${ip} ${method} ${pathname} ${status} ${ms}ms`, { rid }])
  },

  /** Straight to stdout, unprefixed. The startup banner is a multi-line ASCII
   * box; a timestamp and a level in front of each line is strictly worse, and
   * under LOG_JSON=1 they would be mangled into escaped newlines. Having a
   * named function for this is what stops someone "finishing the migration"
   * by wrapping it in log.info later. */
  banner(text) {
    process.stdout.write(`${text}\n`)
  },
}
