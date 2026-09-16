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
    assert.match(provisioning, /canSendEmail = emailConfigured\(\)/)
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
    assert.match(provisioning, /No email transport is configured \(SMTP or Resend\)/)
  })

  test('a PIN-only role is not judged by an email rule', () => {
    /*
     * This was the bug in the first version of this check. It asked for an
     * address and a configured sender unconditionally, and reported the super
     * admin as incomplete because RESEND_API_KEY was unset — a staff rule
     * applied to an account it does not govern.
     *
     * super_admin is in NO_MAILBOX_ROLES. Sign-in skips the OTP for them and
     * recovery.ts branches on the same list, so their Forgot PIN runs
     * recovery PIN -> new PIN with no code at all. Email is not on their path.
     */
    assert.match(provisioning, /usesEmailVerification\('super_admin'\)/)
    assert.match(provisioning, /!superAdminUsesEmail/,
      'A no-mailbox role must short-circuit before the email checks.')

    // And the branch order matters: the email tests must sit AFTER it.
    const block = provisioning.slice(provisioning.indexOf('const recoveryBlockedReason'))
    const shortCircuit = block.indexOf('!superAdminUsesEmail')
    const emailTest = block.indexOf('hasRecoveryEmail')
    assert.ok(shortCircuit > 0 && shortCircuit < emailTest,
      'The email checks must be unreachable for a PIN-only role.')
  })

  test('the one thing a PIN-only account still needs is a recovery PIN', () => {
    // Without it there is no self-service route at all, whatever the role.
    const block = provisioning.slice(provisioning.indexOf('const recoveryBlockedReason'))
    assert.match(block.slice(0, 200), /!hasRecoveryPin/)
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

/**
 * ─── THE SUPER ADMIN IS PIN-ONLY, END TO END ────────────────────────────────
 *
 *   secure setup link  →  temporary PIN  →  new 4-digit PIN  →  portal
 *
 * No email, no password, no code, no Resend, at any step. The pieces already
 * existed; these assert that they still line up, because the failure mode is
 * one branch acquiring an email dependency the others do not have — and the
 * account that would be locked out by it is the one that can lock everybody
 * else out.
 */
describe('super admin sign-in never touches email', () => {
  const verifyPin = codeOf('app/api/auth/verify-pin/route.ts')
  const policy = codeOf('lib/auth/pinPolicy.ts')

  test('the role is declared PIN-only in one place', () => {
    assert.match(policy, /NO_MAILBOX_ROLES: readonly string\[\] = \['super_admin'\]/)
  })

  test('sign-in reads that list rather than a second copy', () => {
    assert.match(verifyPin, /OTP_EXEMPT_ROLES: readonly string\[\] = NO_MAILBOX_ROLES/,
      'Two lists would drift, and the account can then be signed in but not recovered.')
  })

  test('an exempt role skips the OTP entirely', () => {
    assert.match(verifyPin, /if \(!SECRETS\.otpEnabled \|\| otpExempt\)/)
  })

  test('and the missing-email refusal cannot catch them', () => {
    /*
     * That guard exists so an incomplete staff record cannot become an OTP
     * bypass. It must not fire for a role that legitimately has no mailbox.
     */
    assert.match(verifyPin, /if \(!otpExempt && SECRETS\.otpEnabled && !profile\.email\)/)
  })

  test('a single-factor sign-in is still written to the audit log', () => {
    // Full access granted on one factor is worth recording, exemption or not.
    assert.match(verifyPin, /auth\.login_without_otp/)
  })
})

describe('super admin recovery never touches email', () => {
  const recovery = codeOf('lib/auth/recovery.ts')
  const start = codeOf('app/api/auth/recover/start/route.ts')
  const form = codeOf('app/(auth)/login/LoginForm.tsx')

  test('recovery branches on the same list sign-in does', () => {
    assert.match(recovery, /SELF_RECOVERING_ROLES = NO_MAILBOX_ROLES/)
  })

  test('no code is produced for a PIN-only account', () => {
    assert.match(start, /if \(!result\.needsCode\)/)
    assert.match(start, /resetToken: result\.resetToken/,
      'Recovery is already authorised; there is nothing to email.')
  })

  test('and the form goes straight to choosing a new PIN', () => {
    assert.match(form, /if \(d\.needsCode === false && d\.resetToken\)/)
    assert.match(form, /setStep\('recover-new'\)/)
  })
})

describe('the provisioning flow forces a new PIN and lands in the portal', () => {
  const provisioning = codeOf('lib/auth/provisioning.ts')
  const verifyPin = codeOf('app/api/auth/verify-pin/route.ts')
  const form = codeOf('app/(auth)/login/LoginForm.tsx')

  test('the issued PIN cannot become the permanent one', () => {
    assert.match(provisioning, /must_change_pin: true/,
      'They chose neither PIN, so they must choose their own at first sign-in.')
  })

  test('the recovery PIN is NOT rotated by completing a recovery', () => {
    /*
     * It is what gets them back next time; rotating it silently would remove
     * the route they think they still have.
     *
     * Asserted on the WRITE, not on the comment that explains it — codeOf
     * strips comments, and a test that passes because of prose proves nothing
     * about the code.
     */
    const recovery = codeOf('lib/auth/recovery.ts')
    const write = recovery.slice(recovery.indexOf('pin_set_at:'), recovery.indexOf('.eq(\'id\', profile.id)'))
    assert.ok(write.length > 0, 'the recovery write must still be there')
    assert.ok(!/recovery_pin_hash/.test(write),
      'Completing a recovery must not overwrite the recovery PIN.')
    // And the reset token IS consumed, because that one is single use.
    assert.match(write, /reset_token_hash: null/)
  })

  test('sign-in reports the obligation, and the form honours it', () => {
    assert.match(verifyPin, /mustChangePIN: Boolean\(profile\.must_change_pin\)/)
    assert.match(form, /if \(d\.mustChangePIN\) \{ setStep\('set-pin'\); return \}/,
      'The step must not be skippable.')
  })

  test('a session exists before the new PIN is chosen', () => {
    // So setting it is an authenticated action, not a second anonymous one.
    assert.match(verifyPin, /res\.cookies\.set\(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS\)/)
  })

  test('the new PIN is hashed, never stored as typed', () => {
    assert.match(provisioning, /pin_hash: await hashPIN\(signInPin\)/)
    assert.match(codeOf('app/api/auth/change-pin/route.ts'), /hashPIN\(/)
  })

  test('the new PIN must pass the policy', () => {
    assert.match(codeOf('app/api/auth/change-pin/route.ts'), /pinRejectionReason\(/)
  })

  test('and the destination is the portal, not a public page', () => {
    assert.match(verifyPin, /redirect: ROLE_PORTAL\[profile\.role\] \|\| '\/admin'/)
    assert.ok(!/welcome|\/m\/|refer/.test(form.slice(form.indexOf('mustChangePIN'), form.indexOf('mustChangePIN') + 400)),
      'A provisioned super admin must never land on marketing.')
  })
})

describe('the provisioning link can be opened in a browser', () => {
  const unlock = codeOf('app/setup/unlock/route.ts')

  test('it is a GET, because a link is a GET', () => {
    /*
     * /api/setup/open does the same work but is POST-only, so the only way to
     * reach it was a curl command — a poor answer when the owner is locked out
     * of their own portal, and no answer at all on a phone.
     */
    assert.match(unlock, /export async function GET/)
  })

  test('it uses the same authorisation, not a weaker one', () => {
    assert.match(unlock, /describeSetupAuth\(req\)/)
    assert.match(unlock, /if \(!attempt\.ok\)/)
  })

  test('the refusal reveals nothing about the secret', () => {
    /*
     * The POST form returns setupSecretConfigured and suppliedVia, which is
     * useful to an operator debugging their own deployment. A link is opened
     * by whoever has the URL, so it says only that it did not work.
     */
    const denial = unlock.slice(unlock.indexOf('if (!attempt.ok)'), unlock.indexOf('const result'))
    assert.match(denial, /error: 'Not authorised\.'/)
    assert.ok(!/setupSecretConfigured|suppliedVia:\s*attempt\.where\s*\}/.test(
      denial.slice(denial.indexOf('NextResponse.json')),
    ), 'The response must not describe the secret.')
  })

  test('it opens a window and provisions nothing', () => {
    // Nothing is reset until somebody presses the button on /setup, which is
    // a separate one-time claim.
    assert.match(unlock, /openProvisioningWindow\(true\)/)
    assert.ok(!/provisionSuperAdmin/.test(unlock))
  })

  test('it redirects so the secret leaves the address bar', () => {
    assert.match(unlock, /NextResponse\.redirect\(new URL\('\/setup', req\.url\), 303\)/)
  })

  test('it is rate limited and audited exactly as the POST is', () => {
    assert.match(unlock, /rateLimit\(`setup-open:/)
    assert.match(unlock, /setup\.window_denied/)
    assert.match(unlock, /setup\.window_opened/)
  })

  test('and it is reachable without a session', () => {
    // /setup is in the proxy's PUBLIC list, and isMatch covers its subpaths.
    const proxy = codeOf('proxy.ts')
    assert.match(proxy, /'\/setup'/)
    assert.match(proxy, /pathname === p \|\| pathname\.startsWith\(p \+ '\/'\)/)
  })
})


describe('readiness asks whether email works, not which vendor', () => {
  const email = codeOf('lib/integrations/email.ts')

  test('SMTP counts, because it is the preferred transport', () => {
    /*
     * sendEmail tries SMTP FIRST — the campus mailbox — and falls back to
     * Resend. A check that asked about Resend alone reported that staff could
     * not receive a recovery code on a deployment where SMTP was configured
     * and working: a blocker that did not exist, sending somebody after a key
     * they did not need.
     */
    assert.match(email, /export function emailConfigured/)
    assert.match(email, /SECRETS\.smtpHost && SECRETS\.smtpUser && SECRETS\.smtpPass/)
    assert.match(email, /\|\| SECRETS\.resendApiKey/)
  })

  test('and SMTP really is tried first', () => {
    /*
     * Scoped to the SEND function. emailConfigured() names both transports
     * near the top of the file, so a whole-file index comparison measures the
     * predicate rather than the order of attempts.
     */
    const send = email.slice(email.indexOf('const tx = getTransporter()'))
    const smtpAt = send.indexOf('tx.sendMail')
    const resendAt = send.indexOf('SECRETS.resendApiKey')
    assert.ok(smtpAt > 0 && resendAt > 0 && smtpAt < resendAt,
      'if the order ever flips, the predicate is still right but the comment is not')
  })

  test('nothing else asks about one vendor by name', () => {
    const provisioning = codeOf('lib/auth/provisioning.ts')
    assert.ok(!/SECRETS\.resendApiKey/.test(provisioning),
      'readiness must ask whether email works, not which vendor is present')
  })
})
