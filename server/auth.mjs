// Multi-user auth: scrypt-hashed users with roles, admin-issued single-use
// invite links, file-backed sessions. Everything is node core — no deps.
//
// Security notes:
//  - Accounts are only created by (a) first-run setup (bootstrap admin) or
//    (b) accepting an admin-issued invite. The role is taken from the
//    server-stored invite, never from the invitee's request.
//  - Invite tokens are 256-bit random, stored ONLY as a sha256 hash at rest,
//    single-use, 7-day expiry. Session tokens are likewise 256-bit random and
//    stored only as their sha256 hash (the raw token lives only in the cookie).
//  - Password checks are timingSafeEqual; unknown-email logins still run a
//    scrypt (against a dummy salt) so response timing can't enumerate users.
//  - Sessions bind to a userId; a deleted user's sessions are destroyed. Role
//    is read live from the user record, so a role change takes effect at once.

import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR, timingSafeEqualStr, writeAtomic } from './util.mjs'
import { log } from './log.mjs'
const USERS_FILE = join(DATA_DIR, 'users.json')
const INVITES_FILE = join(DATA_DIR, 'invites.json')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')
const API_TOKENS_FILE = join(DATA_DIR, 'api-tokens.json')
const LEGACY_AUTH_FILE = join(DATA_DIR, 'auth.json') // pre-multi-user single account

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days
const INVITE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
// renamed from sb_session — old cookies are simply invalid (one re-login)
const COOKIE = 'guano_session'

export const ROLES = ['admin', 'editor', 'contributor', 'reviewer']
/** admin and editor build pages; a contributor edits content; a reviewer
 * only reads and comments. Every "is this a build-capable account" gate reads
 * this rather than naming the roles it is NOT, so a role added later is
 * refused by default instead of falling through.
 *
 * Pass it `effectiveRole(req, user)` and NEVER `user.role`: the account's role
 * says what it may do from the launcher, the request's effective role says
 * what it may do here. See `effectiveRole` below. */
export const isBuildRole = (role) => role === 'admin' || role === 'editor'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// ---------- users ----------

// { id, name, email, role, salt, hash, kdf?, createdAt }
let users
let migratedAdminId = null // for one-time session backfill

function loadUsers() {
  if (users) return users
  const stored = readJson(USERS_FILE)
  if (Array.isArray(stored)) {
    users = stored
    return users
  }
  // migrate a legacy single account into the first admin
  const legacy = readJson(LEGACY_AUTH_FILE)
  if (legacy?.email && legacy.hash && legacy.salt) {
    const admin = {
      id: randomBytes(12).toString('hex'),
      name: legacy.name ?? '',
      email: String(legacy.email).toLowerCase(),
      role: 'admin',
      salt: legacy.salt,
      hash: legacy.hash,
      createdAt: Date.now(),
    }
    users = [admin]
    migratedAdminId = admin.id
    writeAtomic(USERS_FILE, JSON.stringify(users)).catch((err) =>
      log.error(`auth: could not persist the migrated admin: ${err.message}`),
    )
    return users
  }
  users = []
  return users
}

/**
 * The four writers below LOG and RETHROW.
 *
 * They used to end in an empty catch, so on a read-only volume or a full disk
 * a created user, a sent invite or a new API token succeeded in memory,
 * answered 200, and vanished on the next restart with nothing written
 * anywhere. Rethrowing lets the create paths — which all await — fail the
 * request through the server's catch-all instead of lying about it.
 *
 * Call sites where a write failure genuinely does not matter (a session expiry
 * sweep, a lastUsedAt touch) swallow it at the call, so it is logged exactly
 * once either way.
 */
const persist = async (file, data, what) => {
  try {
    await writeAtomic(file, data)
  } catch (err) {
    log.error(`auth: could not persist ${what}: ${err.message}`)
    throw err
  }
}

const persistUsers = () => persist(USERS_FILE, JSON.stringify(loadUsers()), 'users')

export const needsSetup = () => loadUsers().length === 0
export const findUserById = (id) => loadUsers().find((u) => u.id === id) ?? null
export const findUserByEmail = (email) =>
  loadUsers().find((u) => u.email === String(email ?? '').toLowerCase()) ?? null
export const userProfile = (u) =>
  u
    ? {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        // per-user UI state, not project data: when they last looked at the
        // comments panel and at the form submissions, which is what the rails'
        // unseen dots are derived from
        commentsSeenAt: u.commentsSeenAt ?? 0,
        formsSeenAt: u.formsSeenAt ?? 0,
      }
    : null
export const listUsers = () => loadUsers().map(userProfile)
export const adminCount = () => loadUsers().filter((u) => u.role === 'admin').length

// ---------- key derivation ----------
//
// The cost parameters are stored PER RECORD, which is the only way to raise
// them without invalidating every existing password: a hash written before
// this carries no `kdf`, and absent means the scrypt defaults it was made
// with. Verification always uses the record's own parameters, and a legacy
// record is rehashed at the current cost the next time its owner signs in —
// so the migration happens as people log in, with no flag day and nobody
// locked out.
//
// N=2^17 is the current OWASP floor. It needs 128*N*r = ~134 MB, well over
// node's 32 MB maxmem default, so maxmem has to be raised with it or scrypt
// refuses outright.
const LEGACY_KDF = { N: 16384, r: 8, p: 1 }
const CURRENT_KDF = { N: 131072, r: 8, p: 1 }
const MAXMEM = 256 * 1024 * 1024

/** A password is bounded before it reaches the KDF. Without this a 10 MB
 * request body — the cap on every other write — is a free way to make the
 * server do 10 MB of hashing on an unauthenticated route. */
export const MAX_PASSWORD_LENGTH = 256

const kdfOf = (record) => {
  const k = record?.kdf
  return k && Number.isFinite(k.N) && Number.isFinite(k.r) && Number.isFinite(k.p)
    ? { N: k.N, r: k.r, p: k.p }
    : LEGACY_KDF
}
const isLegacyKdf = (record) => !record?.kdf

function hashPassword(password, salt, kdf = CURRENT_KDF) {
  return scryptSync(password, salt, 64, { ...kdf, maxmem: MAXMEM }).toString('hex')
}

// spend comparable CPU on unknown-email logins so timing can't enumerate users.
// Computed at the CURRENT cost, which is what a new account carries; a legacy
// record is cheaper to verify until its owner next signs in and it is rehashed.
const DUMMY_SALT = randomBytes(16).toString('hex')
let dummyHash = null
const dummy = () => (dummyHash ??= Buffer.from(hashPassword('x'.repeat(24), DUMMY_SALT), 'hex'))

// ---------- password verification (async, concurrency-capped) ----------
//
// Attacker-driven paths (login, current-password check) use the async scrypt
// so a brute-force burst can't freeze the event loop, gated so at most a few
// hashes run at once and a bounded queue waits behind them. Beyond that the
// attempt is shed with VerifyBusyError (→ 429) instead of piling up work.
// Rare trusted-path hashing (account creation, password set) stays sync.

const scryptAsync = promisify(scrypt)
const VERIFY_CONCURRENCY = 2
const VERIFY_QUEUE_MAX = 16
let verifyActive = 0
const verifyWaiters = []

export class VerifyBusyError extends Error {
  constructor() {
    super('too many concurrent attempts')
  }
}

async function computeHash(password, salt, kdf = CURRENT_KDF) {
  if (verifyActive >= VERIFY_CONCURRENCY) {
    if (verifyWaiters.length >= VERIFY_QUEUE_MAX) throw new VerifyBusyError()
    await new Promise((resolve) => verifyWaiters.push(resolve))
  }
  verifyActive++
  try {
    return await scryptAsync(String(password ?? '').slice(0, MAX_PASSWORD_LENGTH), salt, 64, {
      ...kdf,
      maxmem: MAXMEM,
    })
  } finally {
    verifyActive--
    verifyWaiters.shift()?.()
  }
}

/**
 * Verify a password against a `{salt, hash, kdf?}` record, off the event loop
 * and through the same concurrency cap as a login.
 *
 * Exported for the private-site gate, which held its own `scryptSync` on the
 * request path: every wrong guess blocked the loop for the whole derivation,
 * which at the new cost would be a denial of service with ten requests.
 * Throws VerifyBusyError under overload, like the rest of this path.
 */
export async function verifySecret(record, password) {
  if (!record?.salt || !record?.hash) return false
  const computed = await computeHash(password, record.salt, kdfOf(record))
  const stored = Buffer.from(record.hash, 'hex')
  return stored.length === computed.length && timingSafeEqual(stored, computed)
}

/** a fresh `{salt, hash, kdf}` at the current cost */
export function makeCredentials(password) {
  const salt = randomBytes(16).toString('hex')
  return {
    salt,
    hash: hashPassword(String(password ?? '').slice(0, MAX_PASSWORD_LENGTH), salt, CURRENT_KDF),
    kdf: { ...CURRENT_KDF },
  }
}

/** create a user directly — bootstrap admin (setup) or invite acceptance */
async function createUser({ name, email, password, role }) {
  const user = {
    id: randomBytes(12).toString('hex'),
    name: cleanName(name),
    email: String(email).toLowerCase(),
    role: ROLES.includes(role) ? role : 'contributor',
    ...makeCredentials(password),
    createdAt: Date.now(),
  }
  loadUsers().push(user)
  await persistUsers()
  return user
}

/**
 * A display name is bounded, like every other stored string.
 *
 * `/api/auth/update` takes a name from ANY role, reviewers included, and it
 * was persisted whole: a multi-megabyte name is rewritten by every
 * `persistUsers()` from then on and handed to every reader of `/api/users`.
 * Token names were already capped at 100 and snapshot names at 80; this is the
 * same bound in the one place every writer passes through.
 */
const MAX_NAME = 100

const cleanName = (value) => (typeof value === 'string' ? value.slice(0, MAX_NAME) : '')

/** first-run bootstrap: only succeeds when no users exist yet */
export async function createFirstAdmin(email, password, name = '') {
  if (!needsSetup()) return null
  const user = await createUser({ name, email, password, role: 'admin' })
  // a token minted BEFORE this account existed (`guano connect --offline`, the
  // scaffolder) was waiting for exactly this person — bind it here, in the auth
  // module, so a headless setup binds it too
  await bindPendingTokens(user.id)
  // the window this code exists for is closed; leaving the file behind would
  // leave a live-looking secret in the data dir and in the next boot banner
  await clearSetupCode()
  return user
}

// ---------- the first-run setup code ----------
//
// `POST /api/auth/setup` is gated on "no users exist" and nothing else, and
// **the server binds every interface** — so on café wifi, or on a VPS in the
// minutes before its owner opens /admin, the first stranger to reach it became
// the instance's admin. `bindPendingTokens` above makes that worse than it
// sounds: they also inherit every token `guano connect --offline` minted. And
// a data-dir wipe reopens the window on a machine that was already set up.
//
// Loopback stays free, because that is the launcher, `npm run dev` and anyone
// at the machine's own keyboard — the people who already own the data dir. From
// anywhere else the request must carry a code that was printed where the server
// was STARTED, which is a place only the operator can read. 128 bits, so it is
// the sort of thing you paste, and single-use by construction: the account it
// guards can only be created once.
const SETUP_CODE_FILE = join(DATA_DIR, 'setup-code')

let setupCode = null

/** Mint the code (or adopt the one already on disk) — called from boot(). */
export async function ensureSetupCode() {
  if (!needsSetup()) return null
  try {
    const held = readFileSync(SETUP_CODE_FILE, 'utf8').trim()
    if (held) {
      setupCode = held
      return setupCode
    }
  } catch {
    /* not minted yet */
  }
  setupCode = randomBytes(16).toString('hex')
  // 0600 through writeAtomic: the code IS the credential until the admin exists
  await writeAtomic(SETUP_CODE_FILE, `${setupCode}\n`)
  return setupCode
}

/** the minted code, for the boot banner — null once an admin exists */
export const currentSetupCode = () => (needsSetup() ? setupCode : null)

/** constant-time check of what a non-loopback caller sent */
export function setupCodeMatches(given) {
  if (!setupCode) return false
  return typeof given === 'string' && timingSafeEqualStr(setupCode, given.trim())
}

async function clearSetupCode() {
  setupCode = null
  await rm(SETUP_CODE_FILE, { force: true }).catch(() => {})
}

/** constant-time-ish login: returns the user on success, null otherwise.
 *  Throws VerifyBusyError under verification overload. */
export async function verifyLogin(email, password) {
  const user = findUserByEmail(email)
  if (!user) {
    // run a scrypt anyway so timing doesn't reveal whether the email exists
    timingSafeEqual(await computeHash(password, DUMMY_SALT), dummy())
    return null
  }
  if (!(await verifySecret(user, password))) return null
  // The cost migration, such as it is: a record still on the old parameters is
  // rewritten at the current ones now that we hold the plaintext. Nothing is
  // blocked on it — a failed write means the record keeps verifying as it did.
  if (isLegacyKdf(user)) {
    Object.assign(user, makeCredentials(password))
    // the password already verified; a failed write only means the record
    // keeps its old parameters and is tried again at the next sign-in
    await persistUsers().catch(() => {})
  }
  return user
}

/** throws VerifyBusyError under verification overload */
export async function verifyUserPassword(user, password) {
  if (!user) return false
  return verifySecret(user, password)
}

export async function updateUser(id, { name, email, password }) {
  const user = findUserById(id)
  if (!user) return null
  if (typeof name === 'string') user.name = cleanName(name)
  if (typeof email === 'string') user.email = email.toLowerCase()
  if (typeof password === 'string' && password) Object.assign(user, makeCredentials(password))
  await persistUsers()
  return user
}

/** the per-user "last looked at" stamps, by what was looked at */
export const SEEN_FIELDS = { comments: 'commentsSeenAt', forms: 'formsSeenAt' }

/** stamp when this user last looked at the comments panel, or at the form
 * submissions. Monotonic — a second tab with a stale clock must not drag the
 * stamp backwards and light the dot again — and clamped to now, so a client
 * cannot mark the future seen and hide everything written from here on. */
export async function setSeenAt(id, kind, at) {
  const field = SEEN_FIELDS[kind]
  if (!field) return null
  const user = findUserById(id)
  if (!user) return null
  const next = Math.min(Number(at) || 0, Date.now())
  if (next > (user[field] ?? 0)) {
    user[field] = next
    await persistUsers()
  }
  return user
}

export async function setUserRole(id, role) {
  const user = findUserById(id)
  if (!user || !ROLES.includes(role)) return null
  // never demote the last admin (lockout guard)
  if (user.role === 'admin' && role !== 'admin' && adminCount() <= 1) return null
  user.role = role
  await persistUsers()
  return user
}

export async function deleteUser(id) {
  const user = findUserById(id)
  if (!user) return false
  if (user.role === 'admin' && adminCount() <= 1) return false // keep one admin
  users = loadUsers().filter((u) => u.id !== id)
  destroyUserSessions(id) // revoke access immediately
  destroyUserApiTokens(id) // ...and their API tokens
  await persistUsers()
  return true
}

// ---------- sessions ----------

// keyed by sha256(token), never the raw token — a leaked sessions.json can't
// be replayed as live cookies. Sessions written before this change were keyed
// by the raw token; they no longer match and are simply re-authenticated.
const sessions = new Map() // sha256(token) → { userId, createdAt, expiresAt }
{
  loadUsers() // ensure migration ran (sets migratedAdminId) before backfill
  const stored = readJson(SESSIONS_FILE)
  const now = Date.now()
  if (stored) {
    for (const [key, s] of Object.entries(stored)) {
      if (s.expiresAt <= now) continue
      const userId = s.userId ?? migratedAdminId // backfill pre-multi-user sessions
      if (userId && findUserById(userId)) sessions.set(key, { ...s, userId })
    }
  }
}

const persistSessions = () =>
  persist(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)), 'sessions')

/**
 * Mint a session. `via` records HOW it was minted — 'launcher' for a session
 * the desktop app obtained through the loopback-only launcher route, absent
 * for an ordinary password login. It rides on the session record rather than
 * a second cookie so there is nothing a page could forge, and so the tag
 * lives exactly as long as the session it describes.
 */
export function createSession(userId, { via } = {}) {
  const token = randomBytes(32).toString('hex')
  sessions.set(sha256(token), {
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
    ...(via ? { via } : {}),
  })
  void persistSessions().catch(() => {})
  return token // raw token goes to the cookie; only its hash is stored
}

export function destroySession(token) {
  if (sessions.delete(sha256(token))) void persistSessions().catch(() => {})
}

/** revoke every session a user holds — used on delete, and on a password
 * change so a stolen 30-day cookie dies with the old password */
export function destroyUserSessions(userId) {
  let changed = false
  for (const [key, s] of sessions) {
    if (s.userId === userId) {
      sessions.delete(key)
      changed = true
    }
  }
  if (changed) void persistSessions().catch(() => {})
}

// Throttled like a token's `lastUsedAt`, and for the same reason: every authed
// request would otherwise fsync sessions.json.
const SEEN_THROTTLE = 60 * 1000

function getSession(token) {
  if (!token) return null
  const key = sha256(token)
  const session = sessions.get(key)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key)
    void persistSessions().catch(() => {})
    return null
  }
  // WHEN this session was last used, which is the only way to answer "is
  // anyone else working on this instance right now". `expiresAt` is thirty days
  // out and says nothing: a session nobody has touched since last month looks
  // identical to one in use. The launcher's **Bring back to this Mac** asks
  // this before it moves a project off a server, because a move is not a sync
  // and someone else's unsaved window is work that would simply stop.
  const now = Date.now()
  if (!session.lastSeenAt || now - session.lastSeenAt > SEEN_THROTTLE) {
    session.lastSeenAt = now
    void persistSessions().catch(() => {})
  }
  return session
}

/**
 * Who has used a session recently, and how recently.
 *
 * By USER, not by session: two tabs are one person. `null` for an account with
 * no live session at all, so a caller can tell "nobody" from "a while ago".
 */
export function lastSeenByUser() {
  const out = new Map()
  const now = Date.now()
  for (const s of sessions.values()) {
    if (s.expiresAt <= now) continue
    const at = s.lastSeenAt ?? s.createdAt ?? 0
    if (at > (out.get(s.userId) ?? 0)) out.set(s.userId, at)
  }
  return out
}

// ---------- cookies ----------

export function parseCookies(req) {
  const out = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

// Secure by default: browsers accept Secure cookies on http://localhost, so
// local dev keeps working untouched, while a deployed instance never ships
// the session cookie over plain HTTP by accident. A plain-HTTP deploy (LAN
// IP, no TLS proxy) must opt out explicitly with COOKIE_SECURE=0.
const cookieSecure = process.env.COOKIE_SECURE !== '0'
const secure = cookieSecure ? '; Secure' : ''

/**
 * `secure` is an option because ONE caller opts out: the launcher-session
 * route, which is loopback-only by construction and whose cookie is written
 * into WebKit's store by the desktop app rather than accepted from a
 * response. Every other caller takes the COOKIE_SECURE default.
 */
export const sessionCookieHeader = (token, { secure: wantSecure = cookieSecure } = {}) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}` +
  (wantSecure ? '; Secure' : '')
export const clearCookieHeader = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
export const sessionTokenOf = (req) => parseCookies(req)[COOKIE] ?? null

/** a user is only usable if it carries a known role — a missing/invalid role
 * is treated as un-provisioned and rejected everywhere (never trusted) */
export const hasValidRole = (user) => !!user && ROLES.includes(user.role)

/** the authenticated user for a request, or null (role is read live).
 * Users without a valid role are rejected — no ambiguous/partial access. */
export function sessionUser(req) {
  const session = getSession(sessionTokenOf(req))
  const user = session ? findUserById(session.userId) : null
  return hasValidRole(user) ? user : null
}

/** How this request's session was minted: 'launcher', or null for a password
 * login (and for no session at all). Read it BEFORE anything that could
 * revoke the session — a password change destroys the record first. */
export function sessionVia(req) {
  const session = getSession(sessionTokenOf(req))
  return session?.via === 'launcher' ? 'launcher' : null
}

/**
 * True when this request authenticated as an MCP agent (an agent-kind bearer)
 * rather than a human at a browser. Mirrors `requestUser`'s precedence — a
 * session cookie wins when both are present — so the two can never disagree
 * about who is calling. This is the signal the agent policy gates on.
 */
export const isAgentRequest = (req) =>
  !sessionUser(req) && (req.headers.authorization ?? '').startsWith(`Bearer ${TOKEN_KINDS.agent}`)

/**
 * May this REQUEST build, if its account can?
 *
 * Two kinds of caller may: a session the desktop launcher minted
 * (`via: 'launcher'` — two proofs, one route, nothing else mints it), and an
 * agent bearer, which is not capped here because it has its own gate in the
 * agent policy and is judged by how it authenticated. Everything else is a
 * browser, and *a browser session is never a builder session*.
 */
export const isBuilderRequest = (req) => sessionVia(req) === 'launcher' || isAgentRequest(req)

/**
 * The role this REQUEST may act with: the account's own when the request can
 * build, otherwise capped at `contributor` — so an admin signed in to their
 * own deployed instance in Safari is content-only at every gate, and a
 * reviewer stays a reviewer (they are below a contributor, not above).
 *
 * EVERY "may this account build" gate reads `isBuildRole(effectiveRole(req,
 * user))`, never `isBuildRole(user.role)`. A route written later must do the
 * same; that is why this sentence sits beside `isBuildRole` rather than in a
 * doc nobody opens mid-edit. The Build surface lives in the desktop launcher,
 * and the rule is enforced HERE, not by hiding UI — a test that only checks
 * the chrome tests nothing.
 */
export const effectiveRole = (req, user) => {
  if (!hasValidRole(user)) return null
  if (isBuilderRequest(req)) return user.role
  return isBuildRole(user.role) ? 'contributor' : user.role
}

/** The account a launcher session is minted for: one instance has one owner,
 * and that is the admin who set it up. Oldest wins so a second admin added
 * later never takes the desktop app's seat. */
export function oldestAdmin() {
  return (
    loadUsers()
      .filter((u) => u.role === 'admin')
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0] ?? null
  )
}

// ---------- invites ----------

// { id, tokenHash, email, name, role, invitedBy, createdAt, expiresAt, usedAt }
// Only the sha256 `tokenHash` is stored — never the raw token. The raw link is
// shown once, in the create/regenerate response; a lost link is re-issued via
// regenerate (which mints a new token). A leaked invites.json can no longer be
// used to accept a pending invite.
let invites = readJson(INVITES_FILE) ?? []
const persistInvites = () => persist(INVITES_FILE, JSON.stringify(invites), 'invites')

const inviteActive = (i) => !i.usedAt && i.expiresAt > Date.now()

/** base view (no token) — safe for the public accept page */
export const inviteView = (i) => ({
  id: i.id,
  name: i.name,
  email: i.email,
  role: i.role,
  invitedBy: i.invitedBy ?? '',
  expiresAt: i.expiresAt,
})

/** pending (unused, unexpired) invites for the admin list. No raw token — it
 * is not stored; a lost link is re-issued via regenerate. */
export const listInvites = () => invites.filter(inviteActive).map(inviteView)

/** redacted pending invites for the all-roles members view (no token/id/name) */
export const listInvitesPublic = () =>
  invites.filter(inviteActive).map((i) => ({ email: i.email, role: i.role, expiresAt: i.expiresAt }))

/** redacted member list for the all-roles view (no ids — non-admins have no actions) */
export const listMembers = () => {
  const seen = lastSeenByUser()
  return loadUsers().map((u) => ({
    name: u.name,
    email: u.email,
    role: u.role,
    // No id — non-admins have no actions, and this view is editor+ (S14).
    // `lastSeenAt` is not an id: it says whether anyone else is working here,
    // which is what the launcher asks before moving a project off a server.
    lastSeenAt: seen.get(u.id) ?? null,
  }))
}

/** create a single-use invite; returns { invite, token } */
export async function createInvite({ name, email, role, invitedBy }) {
  const token = randomBytes(32).toString('hex')
  const invite = {
    id: randomBytes(12).toString('hex'),
    tokenHash: sha256(token), // raw token is returned once, never stored
    email: String(email).toLowerCase(),
    name: cleanName(name),
    role: ROLES.includes(role) ? role : 'contributor',
    invitedBy: cleanName(invitedBy),
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITE_TTL,
    usedAt: null,
  }
  invites.push(invite)
  await persistInvites()
  return { invite, token }
}

/** edit a pending invite: change role, extend the window, or regenerate the
 * link (new token, old one dies). Returns the admin view or null. */
export async function updateInvite(id, { role, extend, regenerate } = {}) {
  const invite = invites.find((i) => i.id === id && inviteActive(i))
  if (!invite) return null
  if (role !== undefined) {
    if (!ROLES.includes(role)) return null
    invite.role = role
  }
  if (extend) invite.expiresAt = Date.now() + INVITE_TTL
  let freshToken = null
  if (regenerate) {
    freshToken = randomBytes(32).toString('hex')
    invite.tokenHash = sha256(freshToken) // store only the hash of the new token
    invite.createdAt = Date.now()
    invite.expiresAt = Date.now() + INVITE_TTL
  }
  await persistInvites()
  // the fresh raw link is surfaced once here; null when not regenerated
  return { ...inviteView(invite), token: freshToken }
}

export async function revokeInvite(id) {
  const before = invites.length
  invites = invites.filter((i) => i.id !== id)
  if (invites.length !== before) await persistInvites()
  return invites.length !== before
}

/** the active invite for a raw token, or null */
export function findInviteByToken(token) {
  const hash = sha256(String(token ?? ''))
  return invites.find((i) => i.tokenHash === hash && inviteActive(i)) ?? null
}

/** accept an invite: create the user with the invite's role, mark it used */
export async function acceptInvite(token, password) {
  const invite = findInviteByToken(token)
  if (!invite) return { error: 'invalid or expired invite' }
  if (findUserByEmail(invite.email)) {
    invite.usedAt = Date.now()
    await persistInvites()
    return { error: 'this email already has an account' }
  }
  const user = await createUser({
    name: invite.name,
    email: invite.email,
    password,
    role: invite.role, // role is fixed server-side — never from the client
  })
  invite.usedAt = Date.now()
  await persistInvites()
  return { user }
}

// ---------- API tokens (bearer credential for the MCP server & CI) ----------

// { id, tokenHash, userId, name, kind, createdAt, lastUsedAt, pendingFirstAdmin? }
// Raw token format `<prefix><48 hex>`, shown EXACTLY once at creation. Only the
// sha256 hash is stored — a leaked api-tokens.json can't be replayed. The
// owning user's role is read LIVE at auth time (findUserById), so demotion or
// deletion takes effect on the very next request. Mirrors the invite pattern.
//
// A PENDING record (`userId: null, pendingFirstAdmin: true`) is one minted
// before any account existed — `npm create @useguano` connects Claude Desktop
// at scaffold time, and `guano connect --offline` does the same by hand. It
// authenticates nobody (apiTokenUser finds no user) until `createFirstAdmin`
// binds every pending record to the first admin. Whoever can write the data
// dir before setup owns the instance anyway, so this grants nothing new.
let apiTokens = readJson(API_TOKENS_FILE) ?? []
const persistApiTokens = () =>
  persist(API_TOKENS_FILE, JSON.stringify(apiTokens), 'api tokens')

/**
 * The two token KINDS, as prefixes rather than a field.
 *
 * An agent token is `guano_…` and a launcher token is `guanol_…`, and they are
 * different TYPES to every parser: `apiTokenUser` reads the agent prefix and
 * nothing else, `launcherTokenUser` reads the launcher prefix and nothing
 * else. The two strings are disjoint — `'guanol_'.startsWith('guano_')` is
 * false, because what follows `guano` is `l` and not `_` — so neither resolves
 * where the other belongs. Not "is refused": cannot be read.
 *
 * WHY A PREFIX. Agents are gated by the agent policy (`allowMainWrites`,
 * `allowPublish`) because they are judged by HOW they authenticated. If the
 * `/api/auth/launcher-session` exchange accepted any `guano_` token, an
 * injected agent would trade its token for a cookie, stop being an agent in
 * the server's eyes, and write Main with the policy off. `kind` is stored too,
 * for the admin's token list, but the prefix is the enforcement — a field is a
 * check someone can forget.
 */
export const TOKEN_KINDS = { agent: 'guano_', launcher: 'guanol_' }

/** A record written before kinds existed carries no `kind`; every one of them
 *  is `guano_`-prefixed, so absent means agent. */
const kindOf = (t) => (t.kind === 'launcher' ? 'launcher' : 'agent')

const apiTokenView = (t) => ({
  id: t.id,
  name: t.name,
  kind: kindOf(t),
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt,
})

/** a user's tokens, newest first, without hashes. A pending record has no
 *  owner and is listed under nobody. */
export const listApiTokens = (userId) =>
  apiTokens
    .filter((t) => userId != null && t.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(apiTokenView)

export const apiTokenCount = (userId) =>
  apiTokens.filter((t) => userId != null && t.userId === userId).length

/** tokens waiting for the first admin (the banner names them on first run) */
export const pendingTokenCount = () => apiTokens.filter((t) => t.pendingFirstAdmin).length

/** hand every pending record to the user who just became the first admin */
export async function bindPendingTokens(userId) {
  let bound = 0
  for (const t of apiTokens) {
    if (!t.pendingFirstAdmin) continue
    t.userId = userId
    delete t.pendingFirstAdmin
    bound++
  }
  if (bound) await persistApiTokens()
  return bound
}

/** create a token for a user; returns { token: raw (shown once), record }.
 *  `userId: null` makes a PENDING record (see above). `kind` picks the prefix,
 *  and the prefix is what every parser downstream judges it by. */
export async function createApiToken(userId, name, { kind = 'agent' } = {}) {
  const resolved = kind === 'launcher' ? 'launcher' : 'agent'
  const raw = TOKEN_KINDS[resolved] + randomBytes(24).toString('hex') // 48 hex chars
  const token = {
    id: randomBytes(12).toString('hex'),
    tokenHash: sha256(raw), // raw is returned once, never stored
    userId,
    name: typeof name === 'string' ? name.slice(0, 100) : '',
    kind: resolved,
    createdAt: Date.now(),
    lastUsedAt: null,
    ...(userId == null ? { pendingFirstAdmin: true } : {}),
  }
  apiTokens.push(token)
  await persistApiTokens()
  return { token: raw, record: apiTokenView(token) }
}

/** local-trust bootstrap (`guano connect`): mint a token for the first admin.
 *  The caller proves instance ownership via a nonce file in DATA_DIR (checked
 *  by the /api/auth/connect route) — filesystem access = owner. */
export async function bootstrapConnectToken(name) {
  const admin = loadUsers().find((u) => u.role === 'admin')
  if (!admin) {
    // no account yet: a PENDING token, bound to the first admin at setup
    const { token } = await createApiToken(null, name || 'guano connect')
    return { token, email: null, pending: true }
  }
  const { token } = await createApiToken(admin.id, name || 'guano connect')
  return { token, email: admin.email }
}

/** revoke a token: the owner may revoke their own; an admin may revoke any */
export async function revokeApiToken(id, requester) {
  const token = apiTokens.find((t) => t.id === id)
  if (!token) return false
  // a pending record has no owner (userId null) — only an admin may revoke it
  const isOwner = token.userId != null && requester?.id === token.userId
  const isAdmin = requester?.role === 'admin'
  if (!isOwner && !isAdmin) return false
  apiTokens = apiTokens.filter((t) => t.id !== id)
  await persistApiTokens()
  return true
}

function destroyUserApiTokens(userId) {
  const before = apiTokens.length
  apiTokens = apiTokens.filter((t) => t.userId !== userId)
  if (apiTokens.length !== before) void persistApiTokens().catch(() => {})
}

// throttle lastUsedAt persistence — every authed API call would otherwise fsync
const LAST_USED_THROTTLE = 60 * 1000

/**
 * Resolve a raw bearer token of ONE kind to its live owning user, or null.
 * Updates lastUsedAt (throttled). A deleted or role-less owner → null (token
 * dead). The `want` kind is checked twice, against the prefix and against the
 * record, so a stored `kind` that somehow disagreed with the string could only
 * ever refuse — never widen.
 */
function tokenUser(rawToken, want) {
  const raw = String(rawToken ?? '')
  if (!raw.startsWith(TOKEN_KINDS[want])) return null
  const hash = sha256(raw)
  // compare every candidate; no early break so a match's position can't be
  // timed (the set is tiny, so scanning all of it is negligible)
  let match = null
  for (const t of apiTokens) if (timingSafeEqualStr(t.tokenHash, hash)) match = t
  if (!match || match.userId == null) return null // pending → nobody yet
  if (kindOf(match) !== want) return null
  const user = findUserById(match.userId)
  if (!hasValidRole(user)) return null // deleted / de-roled → dead token
  const now = Date.now()
  if (!match.lastUsedAt || now - match.lastUsedAt > LAST_USED_THROTTLE) {
    match.lastUsedAt = now
    void persistApiTokens().catch(() => {})
  }
  return user
}

/** the owner of an AGENT token (`guano_…`) — the MCP server's credential, and
 *  the only kind `requestUser` can read */
export const apiTokenUser = (rawToken) => tokenUser(rawToken, 'agent')

/** the owner of a LAUNCHER token (`guanol_…`) — read by exactly one route,
 *  `POST /api/auth/launcher-session`, and by nothing else anywhere */
export const launcherTokenUser = (rawToken) => tokenUser(rawToken, 'launcher')

// ---------- rate limiting (per key, in-memory fixed window) ----------

function limiter(windowMs, max) {
  const hits = new Map() // key → { count, windowStart }
  const expired = (e) => Date.now() - e.windowStart > windowMs
  return {
    allowed(key) {
      const e = hits.get(key)
      if (!e || expired(e)) return true
      return e.count < max
    },
    record(key) {
      // attacker-supplied keys (emails, spoofable IPs) would grow the map
      // without bound — sweep expired windows once it gets big
      if (hits.size >= 512) {
        for (const [k, e] of hits) if (expired(e)) hits.delete(k)
      }
      const e = hits.get(key)
      if (!e || expired(e)) {
        hits.set(key, { count: 1, windowStart: Date.now() })
      } else {
        e.count++
      }
    },
  }
}

// The strict budget is per (ip, email) PAIR, so an attacker probing an
// account exhausts their own allowance, not the victim's (a hard per-email
// lock let 10 wrong guesses from anywhere freeze a targeted account). The
// per-IP cap bounds one source spraying many emails; the loose per-email
// cap is only a backstop against a distributed attack on one account —
// generous enough that a user's own typos never trip it.
const loginByPair = limiter(15 * 60 * 1000, 10)
const loginByIp = limiter(15 * 60 * 1000, 30)
const loginByEmail = limiter(15 * 60 * 1000, 50)
const inviteByIp = limiter(15 * 60 * 1000, 30)
// bearer-token auth failures per IP — an attacker guessing tokens is shed
const apiTokenByIp = limiter(15 * 60 * 1000, 30)

const emailKey = (email) => String(email ?? '').toLowerCase()
const pairKey = (ip, email) => `${ip}|${emailKey(email)}`

export const loginAllowed = (ip, email) =>
  loginByPair.allowed(pairKey(ip, email)) &&
  loginByIp.allowed(ip) &&
  loginByEmail.allowed(emailKey(email))
export function recordLoginFailure(ip, email) {
  loginByPair.record(pairKey(ip, email))
  loginByIp.record(ip)
  loginByEmail.record(emailKey(email))
}
export const inviteAllowed = (ip) => inviteByIp.allowed(ip)
export const recordInviteAttempt = (ip) => inviteByIp.record(ip)

export const apiTokenAllowed = (ip) => apiTokenByIp.allowed(ip)
export const recordApiTokenFailure = (ip) => apiTokenByIp.record(ip)
