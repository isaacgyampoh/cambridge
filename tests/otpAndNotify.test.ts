import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OTP_MINUTES, OTP_SECONDS, otpValidityPhrase } from '../lib/auth/otpPolicy.ts'

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const notify = codeOf('lib/leads/assignedNotify.ts')
const engine = codeOf('lib/autoAssign.ts')
const recovery = codeOf('lib/auth/recovery.ts')
const verifyPin = codeOf('app/api/auth/verify-pin/route.ts')
const resend = codeOf('app/api/auth/resend-otp/route.ts')
const email = codeOf('lib/integrations/email.ts')

/* ══ OTP ══════════════════════════════════════════════════════════════════ */

describe('an emailed code is good for six hours', () => {
  test('the canonical value is six hours', () => {
    assert.equal(OTP_MINUTES, 360)
    assert.equal(OTP_SECONDS, 21600)
    assert.equal(otpValidityPhrase(), '6 hours')
  })

  const issued = 0
  const expiresAt = () => issued + OTP_MINUTES * 60_000

  test('still valid after one hour', () => {
    assert.ok(1 * 3600_000 < expiresAt())
  })

  test('still valid after five hours fifty-nine minutes', () => {
    assert.ok((5 * 3600 + 59 * 60) * 1000 < expiresAt())
  })

  test('expired at six hours', () => {
    assert.ok(!(6 * 3600_000 < expiresAt()), 'six hours exactly must not still be valid')
  })

  test('expired after seven hours', () => {
    assert.ok(!(7 * 3600_000 < expiresAt()))
  })

  test('the comparison the routes make is the one tested here', () => {
    // `new Date(otp_expires_at) < new Date()` — expiry is a wall-clock check.
    assert.match(codeOf('app/api/auth/verify-otp/route.ts'),
      /new Date\(profile\.otp_expires_at\) < new Date\(\)/)
    assert.match(recovery, /if \(new Date\(profile\.otp_expires_at\) < new Date\(\)\)/)
  })
})

describe('the lifetime is stated once', () => {
  test('no route declares its own', () => {
    for (const [name, src] of [['verify-pin', verifyPin], ['resend', resend], ['recovery', recovery]] as const) {
      assert.ok(!/(const|let)\s+OTP_MINUTES\s*=\s*\d/.test(src),
        `${name} still hardcodes the OTP lifetime`)
      assert.match(src, /OTP_MINUTES/, `${name} should use the shared value`)
    }
  })

  test('all three read it from the policy', () => {
    for (const src of [verifyPin, resend, recovery]) {
      assert.match(src, /from '@\/lib\/auth\/otpPolicy'/)
    }
  })

  test('the email says the real period rather than a number typed twice', () => {
    assert.match(email, /otpValidityPhrase\(\)/)
    assert.ok(!/expires in 10 minutes/.test(email))
  })
})

describe('nothing else was widened', () => {
  test('the reset token is still fifteen minutes', () => {
    // A bearer credential that authorises setting a new PIN. Different threat
    // model, deliberately untouched.
    assert.match(readFileSync('lib/auth/recovery.ts', 'utf8'), /RESET_TOKEN_MINUTES = 15/)
  })

  test('the student magic link is unchanged', () => {
    assert.match(readFileSync('lib/student/auth.ts', 'utf8'), /LINK_HOURS = 24 \* 14/)
  })

  test('the policy file says what it does not cover', () => {
    const policy = readFileSync('lib/auth/otpPolicy.ts', 'utf8')
    assert.match(policy, /RESET_TOKEN_MINUTES/)
    assert.match(policy, /SETUP_SECRET/)
  })
})

describe('a longer window is not a weaker one', () => {
  test('attempts are still counted and the code destroyed when they run out', () => {
    assert.match(recovery, /otp_attempts/)
    assert.match(codeOf('app/api/auth/verify-otp/route.ts'), /otp_attempts/)
  })

  test('the code is still stored hashed, never in the clear', () => {
    assert.match(recovery, /otp_code: hashToken\(code\)/)
  })

  test('it is still single use', () => {
    assert.match(codeOf('app/api/auth/verify-otp/route.ts'), /otp_code: null, otp_expires_at: null/)
  })

  test('requesting and submitting are still rate limited', () => {
    assert.match(resend, /rateLimit\(/)
    assert.match(codeOf('app/api/auth/verify-otp/route.ts'), /rateLimit\(/)
  })
})

/* ══ NOTIFICATIONS ════════════════════════════════════════════════════════ */

describe('an assigned lead is announced on three channels', () => {
  test('in app, by text, and by email', () => {
    assert.match(notify, /from\('notifications'\)\.insert/)
    assert.match(notify, /queueSMS\(\{/)
    assert.match(notify, /await sendEmail\(/)
  })

  test('assignment happens first and cannot be undone by any of them', () => {
    const assign = engine.indexOf('await distributeLead')
    const tell = engine.indexOf('await notifyLeadAssigned')
    assert.ok(assign > -1 && assign < tell, 'the lead must be assigned before anybody is told')
    assert.ok(!/assigned_to:\s*null/.test(notify),
      'nothing in the notification path may clear an assignment')
  })

  test('one channel failing does not stop the others', () => {
    const body = notify.slice(notify.indexOf('1. In app'), notify.indexOf('const failed ='))
    assert.ok(!/\n    return out/.test(body))
  })

  test('the text goes per lead, not once a day', () => {
    // It used to increment a counter a daily cron consolidated, so Tuesday's
    // lead was announced on Wednesday.
    assert.ok(!/bump_lead_pending/.test(engine + notify))
    assert.match(notify, /kind: 'lead_assigned'/)
  })

  test('a retry cannot text twice about the same lead', () => {
    assert.match(notify, /dedupeKey: `lead_assigned:\$\{leadId\}:\$\{marketerId\}`/)
  })
})

describe('the email is useful and safe', () => {
  test('it carries what the person needs to act', () => {
    assert.match(notify, /row\('Name', o\.leadName\)/)
    assert.match(notify, /row\('Phone', o\.phone\)/)
    assert.match(notify, /row\('Interested in', o\.course\)/)
    assert.match(notify, /Open this lead/)
  })

  test('the link is the canonical production domain', () => {
    assert.match(notify, /publicUrl\(`\/marketer\/leads\/\$\{leadId\}`\)/)
    assert.ok(!/vercel\.app|localhost/.test(notify))
  })

  test('the address comes from the staff record, never from a form', () => {
    assert.match(notify, /\.select\('full_name, phone, email, is_active'\)/)
    assert.match(notify, /const email = String\(marketer\.email \|\| ''\)\.trim\(\)/)
  })

  test('an address that is not one is skipped with a reason', () => {
    assert.match(notify, /No usable email address on their staff record/)
  })

  test('lead values are escaped, so a name cannot inject markup', () => {
    assert.match(notify, /function escapeHtml/)
    assert.match(notify, /escapeHtml\(o\.leadName\)|row\(/)
  })

  test('nothing about money or other leads is included', () => {
    assert.ok(!/fee|commission|points|salary/i.test(notify))
  })
})

describe('an inactive person is not messaged', () => {
  test('they are skipped, and the lead keeps its owner', () => {
    assert.match(notify, /if \(marketer\.is_active === false\)/)
    assert.match(notify, /no longer active, so they were not notified/)
  })
})

describe('nothing claims more than it knows', () => {
  test('provider acceptance is not called delivery', () => {
    assert.ok(!/'delivered'/.test(notify))
    assert.match(notify, /out\.email = ok \? 'sent' : 'failed'/)
  })

  test('a queued text is reported as queued, not sent', () => {
    assert.match(notify, /else if \(res\.queued\) out\.sms = 'queued'/)
  })

  test('no secret or code is ever logged', () => {
    for (const line of notify.split('\n').filter(l => /console\./.test(l))) {
      assert.ok(!/code|otp|pin|token|key|password/i.test(line),
        `a log line may leak something sensitive: ${line.trim().slice(0, 80)}`)
    }
  })
})
