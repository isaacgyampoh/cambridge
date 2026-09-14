import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A WAY BACK IN, OR THE APPEARANCE OF ONE.
 *
 * ── HOW THIS WAS FOUND ─────────────────────────────────────────────────────
 *
 * The owner forgot the super admin PIN. Readiness said
 * `provisioningIncomplete: false` — fully provisioned, nothing to do — because
 * the account held a recovery PIN.
 *
 * It did. But a recovery PIN proves nothing on its own: it opens a flow that
 * emails a one-time code to the account's registered address, and only that
 * code lets a new PIN be chosen. The super admin does not use its registered
 * address, so the flow could not complete. The safety net the screen was
 * reporting did not exist.
 *
 * That was discovered at the moment it was needed, which is the only moment
 * the answer matters and the worst one to learn it.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const provisioning = codeOf('lib/auth/provisioning.ts')

describe('readiness asks whether recovery can COMPLETE', () => {
  test('all three conditions are checked, not just the PIN', () => {
    /*
     * A recovery PIN, an address on the account, and a configured sender.
     * Holding two of the three is worth nothing.
     */
    assert.match(provisioning, /hasRecoveryEmail/)
    assert.match(provisioning, /canSendEmail = Boolean\(SECRETS\.resendApiKey\)/)
    assert.match(provisioning, /recoveryReachable = recoveryBlockedReason === null/)
  })

  test('"fully provisioned" now depends on recovery actually working', () => {
    assert.match(provisioning, /provisioningIncomplete: !superAdminExists \|\| !recoveryReachable/,
      'It used to read !hasRecoveryPin, which is the bug.')
  })

  test('each blockage names what to fix', () => {
    // "Incomplete" with no explanation sends somebody looking in the wrong place.
    assert.match(provisioning, /No recovery PIN is set/)
    assert.match(provisioning, /no email address, so the one-time code has nowhere to go/)
    assert.match(provisioning, /RESEND_API_KEY is not configured/)
  })

  test('the address itself is never returned', () => {
    /*
     * This state is served to an anonymous browser — /api/setup/provision is
     * in the proxy's PUBLIC list. Booleans and a reason are facts about the
     * server; the address is not.
     */
    const stateBlock = provisioning.slice(
      provisioning.indexOf('export type ProvisioningState'),
      provisioning.indexOf('export async function openProvisioningWindow'),
    )
    assert.ok(!/\bemail: string/.test(stateBlock),
      'ProvisioningState must not carry the address.')
    assert.match(provisioning, /recoveryReachable: boolean/)
  })
})

describe('the security boundary is unchanged', () => {
  test('a fully credentialed account still needs an explicit reset window', () => {
    /*
     * The guard turns on hasSignInPin && hasRecoveryPin, NOT on
     * provisioningIncomplete. Reporting an account as incomplete must not
     * become a way to reprovision it without SETUP_SECRET and allowReset.
     */
    assert.match(provisioning,
      /state\.superAdminExists && state\.hasSignInPin && state\.hasRecoveryPin\s*\n?\s*&& !openWindow\.allow_reset/,
      'The reset guard must not depend on provisioningIncomplete.')
  })

  test('and provisioning still requires an open window at all', () => {
    assert.match(provisioning, /if \(!openWindow\)[\s\S]{0,220}Setup is not open/)
  })

  test('the window is still claimed exactly once', () => {
    assert.match(provisioning, /\.is\('claimed_at', null\)/)
  })
})

describe('the setup screen says so', () => {
  const page = codeOf('app/setup/page.tsx')

  test('"Recovery can complete" is its own line', () => {
    // Distinct from "Recovery PIN set", because they are different questions.
    assert.match(page, /'Recovery can complete', state\.recoveryReachable/)
    assert.match(page, /'Recovery PIN set', state\.hasRecoveryPin/)
  })

  test('and the reason is shown with what it means', () => {
    assert.match(page, /Forgot PIN will not work/)
    assert.match(page, /recoveryBlockedReason/)
    /*
     * It says what the remaining route IS without naming the variable.
     * /setup is public, and tests/provisioning asserts that this page never
     * handles or mentions the deployment secret — an operator already knows
     * its name, and a stranger has no use for it.
     */
    assert.match(page, /opened on the server by whoever manages this deployment/)
    assert.ok(!/SETUP_SECRET/.test(page), 'A public page must not name the deployment secret.')
  })
})
