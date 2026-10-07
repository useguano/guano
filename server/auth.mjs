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
 * refused by default instead of falling through. */
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
        // comments panel, which is what the rail's unseen dot is derived from
        commentsSeenAt: u.commentsSeenAt ?? 0,
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
    name: typeof name === 'string' ? name : '',
    email: String(email).toLowerCase(),
    role: ROLES.includes(role) ? role : 'contributor',
    ...makeCredentials(password),
    createdAt: Date.now(),
  }
  loadUsers().push(user)
  await persistUsers()
  return user
}

/** first-run bootstrap: only succeeds when no users exist yet */
export async function createFirstAdmin(email, password, name = '') {
  if (!needsSetup()) return null
  const user = await createUser({ name, email, password, role: 'admin' })
  // a token minted BEFORE this account existed (`guano connect --offline`, the
  // scaffolder) was waiting for exactly this person — bind it here, in the auth
  // module, so a headless setup binds it too
  await bindPendingTokens(user.id)
  return user
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
  if (typeof name === 'string') user.name = name
  if (typeof email === 'string') user.email = email.toLowerCase()
  if (typeof password === 'string' && password) Object.assign(user, makeCredentials(password))
  await persistUsers()
  return user
}

/** stamp when this user last looked at the comments panel. Monotonic — a
 * second tab with a stale clock must not drag the stamp backwards and light
 * the dot again — and clamped to now, so a client cannot mark the future
 * seen and hide every comment written from here on. */
export async function setCommentsSeenAt(id, at) {
  const user = findUserById(id)
  if (!user) return null
  const next = Math.min(Number(at) || 0, Date.now())
  if (next > (user.commentsSeenAt ?? 0)) {
    user.commentsSeenAt = next
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

export function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  sessions.set(sha256(token), { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL })
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
  return session
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

export const sessionCookieHeader = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure}`
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
export const listMembers = () =>
  loadUsers().map((u) => ({ name: u.name, email: u.email, role: u.role }))

/** create a single-use invite; returns { invite, token } */
export async function createInvite({ name, email, role, invitedBy }) {
  const token = randomBytes(32).toString('hex')
  const invite = {
    id: randomBytes(12).toString('hex'),
    tokenHash: sha256(token), // raw token is returned once, never stored
    email: String(email).toLowerCase(),
    name: typeof name === 'string' ? name : '',
    role: ROLES.includes(role) ? role : 'contributor',
    invitedBy: typeof invitedBy === 'string' ? invitedBy : '',
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

// { id, tokenHash, userId, name, createdAt, lastUsedAt, pendingFirstAdmin? }
// Raw token format `guano_<48 hex>`, shown EXACTLY once at creation. Only the
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

const apiTokenView = (t) => ({
  id: t.id,
  name: t.name,
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
 *  `userId: null` makes a PENDING record (see above). */
export async function createApiToken(userId, name) {
  const raw = 'guano_' + randomBytes(24).toString('hex') // 48 hex chars
  const token = {
    id: randomBytes(12).toString('hex'),
    tokenHash: sha256(raw), // raw is returned once, never stored
    userId,
    name: typeof name === 'string' ? name.slice(0, 100) : '',
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

/** resolve a raw bearer token to its live owning user, or null. Updates
 *  lastUsedAt (throttled). A deleted or role-less owner → null (token dead). */
export function apiTokenUser(rawToken) {
  const raw = String(rawToken ?? '')
  if (!raw.startsWith('guano_')) return null
  const hash = sha256(raw)
  // compare every candidate; no early break so a match's position can't be
  // timed (the set is tiny, so scanning all of it is negligible)
  let match = null
  for (const t of apiTokens) if (timingSafeEqualStr(t.tokenHash, hash)) match = t
  if (!match || match.userId == null) return null // pending → nobody yet
  const user = findUserById(match.userId)
  if (!hasValidRole(user)) return null // deleted / de-roled → dead token
  const now = Date.now()
  if (!match.lastUsedAt || now - match.lastUsedAt > LAST_USED_THROTTLE) {
    match.lastUsedAt = now
    void persistApiTokens().catch(() => {})
  }
  return user
}

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
