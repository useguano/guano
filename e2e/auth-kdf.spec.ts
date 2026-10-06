import { test, expect } from '@playwright/test'
import { scryptSync, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, instances } from './fixtures/server'

// Password hashing cost, raised from the scrypt library defaults to the
// current OWASP floor.
//
// The whole risk of that change is here: a hash written before it carries no
// cost parameters at all, so verifying it with the NEW ones produces a
// different digest and the password stops working. Every existing account on
// every existing instance is in that state, which makes "a legacy record still
// logs in" the assertion the change lives or dies on.
//
// It needs a server of its own: the user list is read once and cached, so a
// record planted on disk is only seen if it is there before boot.

const LEGACY = { email: 'legacy@example.com', password: 'from-before-the-change' }

/** a user record exactly as the old code wrote one: scrypt at the library
 *  defaults, keylen 64, and NO kdf field to say so */
function legacyUser() {
  const salt = randomBytes(16).toString('hex')
  return {
    id: randomBytes(12).toString('hex'),
    name: 'Legacy Admin',
    email: LEGACY.email,
    role: 'admin',
    salt,
    hash: scryptSync(LEGACY.password, salt, 64).toString('hex'),
    createdAt: Date.now(),
  }
}

test.afterEach(() => {
  for (const i of instances) i.stop()
  instances.length = 0
})

test('a password hashed before the cost rose still logs in, and is rehashed', async () => {
  const planted = legacyUser()
  const srv = await boot('kdf', 4397, {
    prepare: (dataDir) => {
      writeFileSync(join(dataDir, 'users.json'), JSON.stringify([planted]), { mode: 0o600 })
    },
  })
  const usersFile = join(srv.dataDir, 'users.json')

  // the premise: no cost parameters on disk, which is what absent means
  expect(JSON.parse(readFileSync(usersFile, 'utf8'))[0].kdf).toBeUndefined()

  // the assertion the change lives on
  const ok = await srv.api.post('/api/auth/login', { data: LEGACY })
  expect(ok.status(), await ok.text()).toBe(200)

  // ...and the record has been rewritten at the current cost, so the migration
  // happens as people sign in rather than on a flag day
  const after = JSON.parse(readFileSync(usersFile, 'utf8'))[0]
  expect(after.kdf).toMatchObject({ N: 131072, r: 8, p: 1 })
  expect(after.hash).not.toBe(planted.hash)
  expect(after.salt).not.toBe(planted.salt)

  // the rehashed record verifies too — the obvious way to get this wrong is to
  // write parameters that the verify path then ignores
  const again = await srv.api.post('/api/auth/login', { data: LEGACY })
  expect(again.status()).toBe(200)

  // and the wrong password is still wrong, at either cost
  const no = await srv.api.post('/api/auth/login', {
    data: { email: LEGACY.email, password: 'from-before-the-chang' },
  })
  expect(no.status()).toBe(401)
})

test('a password is bounded before it reaches the key derivation', async () => {
  const srv = await boot('kdf-bounds', 4399)

  // Without a cap, the 10 MB body limit that applies to every other write is
  // a free way to make an unauthenticated route derive a key over 10 MB.
  const huge = 'x'.repeat(300_000)
  const res = await srv.api.post('/api/auth/setup', {
    data: { email: 'big@example.com', password: huge, name: 'Big' },
  })
  expect([400, 429]).toContain(res.status())
  expect(await res.text()).toMatch(/at most|too long|invalid/i)
})
