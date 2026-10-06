// A minimal SMTP client: `node:net` + `node:tls`, no dependency.
//
// WHY hand-rolled rather than nodemailer: the same reason zip.mjs is
// hand-rolled. The product ships as one npm package an operator self-hosts,
// and a transactional mail dependency tree is a large attack surface for the
// ~200 lines of protocol we actually use. Every transactional provider
// (Postmark, Resend, SES, Mailgun, Gmail) speaks SMTP, so this keeps the
// product provider-agnostic without a per-provider integration.
//
// Four rules are load-bearing, and each one is a real attack if dropped:
//
//   1. AUTH NEVER HAPPENS IN PLAINTEXT. Port 465 is implicit TLS; every other
//      port must complete STARTTLS first, and if the server does not offer it
//      the connection is torn down without sending credentials. A permissive
//      fallback here would hand the password to anyone on the path.
//   2. CERTIFICATE VERIFICATION STAYS ON. No `rejectUnauthorized: false`,
//      ever, however convenient it is against a self-signed test server.
//   3. EVERY HEADER VALUE GOES THROUGH `headerValue()`, which THROWS on CR, LF
//      or NUL rather than stripping them. A visitor-supplied value reaches
//      `Reply-To`; `foo@example.com\r\nBcc: victim@…` would otherwise turn one
//      notification into a spam relay. Throwing (not stripping) means the
//      submission is recorded and the send fails loudly, instead of silently
//      sending something subtly different from what was asked.
//   4. THE BODY IS DOT-STUFFED. A line that is exactly "." ends the DATA
//      phase; a visitor who writes one in a message field would otherwise
//      truncate the mail and inject raw SMTP commands after it.
import { createConnection } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

const CRLF = '\r\n'
const TIMEOUT = 10_000

/** a header value that cannot break out of its header */
export function headerValue(value, what = 'header') {
  const text = String(value ?? '')
  if (/[\r\n\0]/.test(text)) {
    throw new Error(`${what} contains a line break — refusing to send`)
  }
  return text
}

/** RFC 2047 encoded-word for a non-ASCII header (subject, display name) */
export function encodeHeader(value, what = 'header') {
  const text = headerValue(value, what)
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7e]/.test(text)) return text
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

/** CRLF-normalized and dot-stuffed message body */
export function prepareBody(text) {
  return String(text ?? '')
    .replace(/\r\n|\r|\n/g, CRLF)
    .split(CRLF)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF)
}

/**
 * One SMTP conversation. Resolves when the server has accepted the message (or
 * for `verify`, when AUTH succeeded), rejects with the server's own reply line
 * so an admin sees "535 authentication failed" rather than "send failed".
 */
class Session {
  constructor(socket) {
    this.socket = socket
    this.buffer = ''
    this.waiters = []
    // decode per chunk rather than socket.setEncoding('utf8'): on the STARTTLS
    // path this same socket is handed to tls.connect(), and a socket in string
    // mode feeds the TLS parser strings instead of bytes, which breaks the
    // handshake in a way that looks like an unreachable server.
    socket.on('data', (chunk) => this.#onData(chunk.toString('utf8')))
    socket.on('error', (err) => this.#fail(err))
    socket.on('close', () => this.#fail(new Error('the mail server closed the connection')))
    socket.setTimeout(TIMEOUT, () => this.#fail(new Error('the mail server timed out')))
  }

  #onData(chunk) {
    this.buffer += chunk
    // A reply is zero or more continuation lines "NNN-<text>" then one final
    // line "NNN <text>" (or a bare "NNN"). The separator is what distinguishes
    // them, so the final line's space must NOT be optional: with `NNN ?` the
    // continuation line `250-fake` parses as a complete reply, and every
    // capability after it — STARTTLS, AUTH — is invisible. That reads as "the
    // server does not offer STARTTLS" against every real multi-line server.
    for (;;) {
      const match = this.buffer.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3})(?: ([^\r\n]*))?\r\n/)
      if (!match) return
      const whole = match[0]
      const reply = { code: Number(match[1]), text: whole.trim() }
      this.buffer = this.buffer.slice(whole.length)
      const waiter = this.waiters.shift()
      if (waiter) waiter.resolve(reply)
    }
  }

  #fail(err) {
    this.failed = this.failed ?? err
    // destroy, or a stalled server keeps the socket (and the process) alive
    // after every waiter has been rejected
    this.socket.destroy()
    while (this.waiters.length) this.waiters.shift().reject(err)
  }

  read() {
    if (this.failed) return Promise.reject(this.failed)
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  write(line) {
    this.socket.write(line + CRLF)
  }

  /** send a command and require one of `expect` back */
  async command(line, expect, what) {
    this.write(line)
    const reply = await this.read()
    if (!expect.includes(reply.code)) {
      throw new Error(`${what}: ${reply.text}`)
    }
    return reply
  }

  end() {
    try {
      this.socket.write(`QUIT${CRLF}`)
    } catch {
      /* already gone */
    }
    this.socket.end()
    this.socket.destroy()
  }
}

/** RFC 6066 forbids an IP literal as the TLS SNI name (and node warns) */
const servernameFor = (host) =>
  /^[\d.]+$/.test(host) || host.includes(':') ? undefined : host

function openSocket({ host, port, implicitTls }) {
  return new Promise((resolve, reject) => {
    const socket = implicitTls
      ? tlsConnect({ host, port, servername: servernameFor(host) })
      : createConnection({ host, port })
    const done = (fn, arg) => {
      clearTimeout(timer)
      socket.off('error', onErr)
      fn(arg)
    }
    // A connect (or TLS handshake) a server simply never answers must not hang
    // the send queue — and with it the request that triggered it — forever.
    const timer = setTimeout(() => {
      socket.destroy()
      done(reject, new Error(`could not reach ${host}:${port} within ${TIMEOUT / 1000}s`))
    }, TIMEOUT)
    const onErr = (err) => {
      socket.destroy()
      done(reject, err)
    }
    socket.once('error', onErr)
    socket.once(implicitTls ? 'secureConnect' : 'connect', () => done(resolve, socket))
  })
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    // `host` is what the certificate is checked against. Omit it and node
    // falls back to the literal "localhost", so a valid certificate for the
    // real mail host is REJECTED while a certificate issued for localhost
    // would pass — the check has to name the host we meant to reach.
    // `servername` is the separate SNI extension, which RFC 6066 forbids
    // carrying an IP.
    const secure = tlsConnect({ socket, host, servername: servernameFor(host) })
    const done = (fn, arg) => {
      clearTimeout(timer)
      secure.off('error', onErr)
      fn(arg)
    }
    // the handshake is the one step where a plaintext server answers nothing
    // at all: it saw STARTTLS, said 220, and then waits for a command it can
    // read. Without this timeout the send never settles.
    const timer = setTimeout(() => {
      secure.destroy()
      socket.destroy()
      done(reject, new Error(`the TLS handshake with ${host} timed out`))
    }, TIMEOUT)
    const onErr = (err) => {
      secure.destroy()
      done(reject, err)
    }
    secure.once('error', onErr)
    secure.once('secureConnect', () => done(resolve, secure))
  })
}

/**
 * Connect, greet, secure the channel and authenticate. The caller gets a live
 * session it must `end()`. `requireTls` is never configurable: STARTTLS is
 * mandatory on every port but 465 (which is already TLS).
 */
async function connectAuthenticated({ host, port, user, password }) {
  const implicitTls = Number(port) === 465
  let socket = await openSocket({ host, port: Number(port), implicitTls })
  let session = new Session(socket)
  const greeting = await session.read()
  if (greeting.code !== 220) {
    session.end()
    throw new Error(`unexpected greeting: ${greeting.text}`)
  }
  let ehlo = await session.command(`EHLO ${hostnameFor(host)}`, [250], 'EHLO refused')

  if (!implicitTls) {
    if (!/STARTTLS/i.test(ehlo.text)) {
      session.end()
      throw new Error(
        `${host}:${port} does not offer STARTTLS — refusing to send credentials in plaintext`,
      )
    }
    await session.command('STARTTLS', [220], 'STARTTLS refused')
    // Hand the raw socket to TLS and start a fresh session on the secure one.
    // Every listener this Session installed has to go first — a stale `close`
    // handler would reject the next waiter, and the socket timeout has to be
    // cleared or it fires mid-handshake.
    const raw = session.socket
    raw.removeAllListeners('data')
    raw.removeAllListeners('close')
    raw.removeAllListeners('error')
    raw.removeAllListeners('timeout')
    raw.setTimeout(0)
    socket = await upgradeToTls(raw, host)
    session = new Session(socket)
    ehlo = await session.command(`EHLO ${hostnameFor(host)}`, [250], 'EHLO refused after STARTTLS')
  }

  // AUTH PLAIN, falling back to LOGIN. Both only ever run on a TLS channel.
  const mechanisms = (ehlo.text.match(/AUTH[ =]([A-Z0-9 \-]+)/i)?.[1] ?? '').toUpperCase()
  const plain = Buffer.from(`\0${user}\0${password}`, 'utf8').toString('base64')
  if (!mechanisms || mechanisms.includes('PLAIN')) {
    try {
      await session.command(`AUTH PLAIN ${plain}`, [235], 'authentication failed')
      return session
    } catch (err) {
      if (!mechanisms.includes('LOGIN')) {
        session.end()
        throw err
      }
    }
  }
  await session.command('AUTH LOGIN', [334], 'authentication failed')
  await session.command(Buffer.from(user, 'utf8').toString('base64'), [334], 'authentication failed')
  await session.command(
    Buffer.from(password, 'utf8').toString('base64'),
    [235],
    'authentication failed',
  )
  return session
}

/** the name we greet with — never a bare IP, which some servers reject */
const hostnameFor = (host) => (/^[\d.]+$/.test(host) ? '[127.0.0.1]' : 'guano')

/**
 * Connect and authenticate, then hang up. This is "Send test email" without
 * the email — an admin can check an integration before a visitor does.
 */
export async function smtpVerify({ host, port, user, password }) {
  const session = await connectAuthenticated({ host, port, user, password })
  session.end()
  return { ok: true }
}

/**
 * Send one plain-text message.
 *
 * `from` is ALWAYS the integration's configured address: a visitor's address
 * goes in `replyTo` and nowhere else, so the site never sends mail claiming to
 * be someone else (which is also what keeps SPF/DKIM aligned).
 */
export async function sendMail(
  { host, port, user, password, from },
  { to, subject, text, replyTo },
) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!recipients.length) throw new Error('no recipients')
  const fromAddr = headerValue(from, 'From')
  const headers = [
    `From: ${fromAddr}`,
    `To: ${recipients.map((r) => headerValue(r, 'To')).join(', ')}`,
    `Subject: ${encodeHeader(subject, 'Subject')}`,
    ...(replyTo ? [`Reply-To: ${headerValue(replyTo, 'Reply-To')}`] : []),
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@guano>`,
  ]
  const body = prepareBody(text)

  const session = await connectAuthenticated({ host, port, user, password })
  try {
    await session.command(`MAIL FROM:<${fromAddr}>`, [250], 'MAIL FROM refused')
    for (const rcpt of recipients) {
      await session.command(`RCPT TO:<${headerValue(rcpt, 'To')}>`, [250, 251], 'RCPT TO refused')
    }
    await session.command('DATA', [354], 'DATA refused')
    session.write(`${headers.join(CRLF)}${CRLF}${CRLF}${body}${CRLF}.`)
    const done = await session.read()
    if (done.code !== 250) throw new Error(`the mail server rejected the message: ${done.text}`)
    return { ok: true }
  } finally {
    session.end()
  }
}
