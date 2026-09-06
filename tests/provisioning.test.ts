import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PIN_LENGTH, generatePin, isValidPin, pinRejectionReason } from '../lib/auth/pinPolicy.ts'

/**
 * BROWSER-BASED FIRST-RUN PROVISIONING.
 *
 * ── THE PROBLEM IT SOLVES ──────────────────────────────────────────────────
 *
 * Provisioning must be authorised by SETUP_SECRET, which lives only in the
 * deployment environment and is marked Sensitive so that nobody — including
 * the person who owns the system — can read it back. The old setup page asked
 * the operator to paste that value into a text box. It was a page the person
 * who needed it could never use.
 *
 * ── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 * Authorisation and use are separated in time.
 *
 *   /api/setup/open       requires SETUP_SECRET. Provisions nothing. Opens a
 *                         single-use window, minutes long.
 *   /api/setup/provision  requires NO secret, and refuses outright unless a
 *                         window is open. Spends the window, mints the two
 *                         PINs, returns them once.
 *
 * The danger is turning that into a public provisioning button. These tests
 * hold the properties that stop it becoming one.
 */

const PROVISIONING = readFileSync('lib/auth/provisioning.ts', 'utf8')
const OPEN = readFileSync('app/api/setup/open/route.ts', 'utf8')
const CLAIM = readFileSync('app/api/setup/provision/route.ts', 'utf8')
const PAGE = readFileSync('app/setup/page.tsx', 'utf8')
const MIGRATION = readFileSync('supabase/migrations/0016_setup_window.sql', 'utf8')

/**
 * Source with comments removed.
 *
 * Every one of these files EXPLAINS the rule it follows — "never written to
 * localStorage", "requires SETUP_SECRET" — so a naive text search finds the
 * prose and reports the very thing the prose says does not happen. The checks
 * below are about code, so the prose is stripped first.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments, including doc blocks
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

describe('provisioning cannot happen without authorisation', () => {
  test('opening a window requires the setup secret', () => {
    assert.match(OPEN, /describeSetupAuth\(req\)/)
    assert.match(OPEN, /status:\s*401/)
  })

  test('claiming refuses when no window is open', () => {
    const claim = PROVISIONING.slice(PROVISIONING.indexOf('export async function claimProvisioning'))
    assert.match(claim, /if \(!openWindow\)/)
    assert.match(claim, /status:\s*403/)
  })

  test('the claim endpoint never reads a secret', () => {
    assert.ok(!/describeSetupAuth|SETUP_SECRET|setupSecret/.test(code(CLAIM)),
      'the claim endpoint touches the setup secret, which would defeat the split')
  })

  test('a window only counts while unclaimed and unexpired', () => {
    const claim = PROVISIONING.slice(PROVISIONING.indexOf('export async function claimProvisioning'))
    assert.match(claim, /\.is\('claimed_at', null\)/)
    assert.match(claim, /\.gt\('expires_at'/)
  })
})

describe('a window is single use', () => {
  test('the claim is conditional, so two callers cannot both win', () => {
    const claim = PROVISIONING.slice(PROVISIONING.indexOf('export async function claimProvisioning'))
    const update = claim.slice(claim.indexOf(".update({ claimed_at"))
    assert.match(update, /\.is\('claimed_at', null\)/,
      'the claim is unconditional, so two browsers could both provision')
    assert.match(update, /if \(!claimed\)/)
  })

  test('the window is claimed BEFORE credentials are generated', () => {
    const claim = PROVISIONING.slice(PROVISIONING.indexOf('export async function claimProvisioning'))
    const claimedAt = claim.indexOf(".update({ claimed_at")
    const generatedAt = claim.indexOf('generatePin(randomInt)')
    assert.ok(claimedAt !== -1 && generatedAt !== -1)
    assert.ok(claimedAt < generatedAt,
      'credentials are minted before the window is spent, so a race could mint two sets')
  })

  test('opening a window closes any earlier one', () => {
    const open = PROVISIONING.slice(PROVISIONING.indexOf('export async function openProvisioningWindow'))
    assert.match(open, /outcome: 'superseded'/,
      'two windows could be open at once, widening an earlier narrower authorisation')
  })
})

describe('an existing super admin is not overwritten by accident', () => {
  test('a fully provisioned account needs a window that permits a reset', () => {
    const claim = PROVISIONING.slice(PROVISIONING.indexOf('export async function claimProvisioning'))
    assert.match(claim, /!openWindow\.allow_reset/)
    assert.match(claim, /status:\s*409/)
  })

  test('allow_reset defaults to false in the schema', () => {
    assert.match(MIGRATION, /allow_reset\s+BOOLEAN NOT NULL DEFAULT FALSE/,
      'a window would permit a takeover unless explicitly told not to')
  })
})

describe('the credentials obey the PIN policy', () => {
  test('both PINs are exactly four digits and pass the policy', () => {
    let seed = 11
    const rng = (min: number, max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return min + (seed % (max - min))
    }
    for (let i = 0; i < 200; i++) {
      const pin = generatePin(rng)
      assert.equal(pin.length, PIN_LENGTH)
      assert.equal(isValidPin(pin), true)
      assert.equal(pinRejectionReason(pin), null)
    }
  })

  test('the sign-in PIN and recovery PIN must differ', () => {
    const claim = PROVISIONING.slice(PROVISIONING.indexOf('export async function claimProvisioning'))
    assert.match(claim, /signInPin === recoveryPin/,
      'the same value could be issued for both, blurring signing in and recovering')
  })

  test('a new PIN is checked against other active accounts', () => {
    const claim = PROVISIONING.slice(PROVISIONING.indexOf('export async function claimProvisioning'))
    assert.match(claim, /verifyPIN\(signInPin/,
      'a collision would make two accounts unusable')
  })

  test('the operator is made to choose their own PIN', () => {
    assert.match(PROVISIONING, /must_change_pin: true/)
  })

  test('the recovery PIN is issued and left alone afterwards', () => {
    assert.match(PROVISIONING, /recovery_pin_hash: await hashPIN\(recoveryPin\)/)
  })
})

describe('no credential or secret escapes', () => {
  test('nothing is logged or audited that contains a PIN', () => {
    for (const [name, src] of [
      ['provisioning', PROVISIONING], ['open', OPEN], ['claim', CLAIM],
    ] as const) {
      const lines = src.split('\n').filter(l => {
        const t = l.trim()
        return !t.startsWith('*') && !t.startsWith('//')
      })
      for (const line of lines) {
        if (!/console\.|recordAudit/.test(line)) continue
        assert.ok(!/signInPin|recoveryPin|pin_hash|token_hash|setupSecret/.test(line),
          `${name} may emit a credential: ${line.trim().slice(0, 90)}`)
      }
    }
  })

  test('the setup page never asks for or receives a secret', () => {
    assert.ok(!/SETUP_SECRET|setupSecret/.test(code(PAGE)),
      'the setup page still handles the deployment secret')
    assert.ok(!/type="password"/.test(code(PAGE)),
      'the setup page still has a secret field')
  })

  test('the credentials are not put in storage, a cookie or a URL', () => {
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(code(PAGE)),
      'the setup page persists something it should not')
    assert.ok(!/signInPin=|recoveryPin=/.test(code(PAGE)),
      'a credential is placed in a query string')
  })

  test('copying uses the clipboard only', () => {
    assert.match(PAGE, /navigator\.clipboard\.writeText/)
  })

  test('the window token is stored hashed, never returned', () => {
    assert.match(PROVISIONING, /token_hash: hashToken\(token\)/)
    const open = PROVISIONING.slice(
      PROVISIONING.indexOf('export async function openProvisioningWindow'),
      PROVISIONING.indexOf('export type ProvisionResult')
    )
    assert.ok(!/return.*token[^_]/.test(open.replace(/const token = .*/g, '')),
      'the window token is handed back to a caller')
  })
})

describe('the operator is made to acknowledge the credentials', () => {
  test('leaving the screen requires confirming they were saved', () => {
    assert.match(PAGE, /I have written down both PINs/)
    assert.match(PAGE, /aria-disabled=\{!saved\}/,
      'the continue link is reachable before the operator confirms')
  })
})

describe('state reporting is safe to show anonymously', () => {
  test('the state contains no credential and no secret', () => {
    const state = code(PROVISIONING).slice(
      code(PROVISIONING).indexOf('export type ProvisioningState'),
      code(PROVISIONING).indexOf('export async function readProvisioningState')
    )
    for (const forbidden of ['pin_hash', 'signInPin', 'recoveryPin', 'token', 'secret']) {
      assert.ok(!state.includes(forbidden), `provisioning state exposes ${forbidden}`)
    }
  })

  test('it reports booleans about the server, not values', () => {
    assert.match(PROVISIONING, /superAdminExists: boolean/)
    assert.match(PROVISIONING, /hasRecoveryPin: boolean/)
  })
})
