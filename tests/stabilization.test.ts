import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALWAYS_ALLOWED_PAGES, canReachPage } from '../lib/access/pageAccess.ts'
import { ROLE_DEFAULTS, resolvePortals } from '../lib/access/portals.ts'

/**
 * Regressions from the final internal stabilization audit.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * ─── 1. EVERY MEMBER OF STAFF CAN CHANGE THEIR OWN PIN ──────────────────────
 *
 * The page lives under /admin/settings, which the `settings` portal grants —
 * and `settings` belongs to super_admin ALONE. Not to an administrator.
 *
 * PortalLayout meanwhile renders the "Change PIN" link unconditionally, in
 * the sidebar and in the user menu, for everybody. So ten of the eleven roles
 * were shown the link, clicked it, and were bounced to their own dashboard by
 * the proxy — with no way to rotate the credential this portal authenticates
 * on.
 */
describe('changing your own PIN is not an administrative privilege', () => {
  const PIN_PAGE = '/admin/settings/change-pin'

  test('every role can reach it', () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      const portals = resolvePortals(role, null)
      assert.ok(canReachPage(PIN_PAGE, role, portals),
        `${role} cannot reach ${PIN_PAGE} — they cannot change their own PIN.`)
    }
  })

  test('and it grants nothing else under /admin/settings', () => {
    /*
     * ALWAYS_ALLOWED_PAGES is prefix-matched, so this is the check that the
     * fix did not hand every role an administrative screen on the way past.
     */
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      if (role === 'super_admin') continue
      const portals = resolvePortals(role, null)
      if (portals.includes('settings')) continue
      for (const forbidden of ['/admin/settings', '/admin/automation', '/admin/webhook-log', '/admin/chatbot']) {
        assert.ok(!canReachPage(forbidden, role, portals),
          `${role} gained ${forbidden}, which the PIN fix must not do.`)
      }
    }
  })

  test('the shell offers it, so the page must stay reachable', () => {
    // The link is deliberately NOT canReach()-guarded like the others in that
    // menu: hiding it would mean staff simply cannot change their PIN. The
    // page being always-allowed is what makes showing it correct.
    const shell = codeOf('components/shared/PortalLayout.tsx')
    assert.ok(shell.includes('/admin/settings/change-pin'),
      'The shell no longer links to the PIN page; this test guards the wrong thing now.')
    assert.ok(ALWAYS_ALLOWED_PAGES.includes('/admin/settings/change-pin'))
  })
})

/**
 * ─── 2. A DATABASE BLIP DOES NOT SIGN OUT THE WHOLE CENTRE ──────────────────
 *
 * The proxy runs on every authenticated request. Its session lookup discarded
 * the error, so a failed read fell into the branch that clears the session
 * cookie and reports an expired session — signing out every member of staff
 * at once, mid-task, and preventing any of them from getting back by
 * reloading.
 */
describe('an unverifiable session is refused without being destroyed', () => {
  const src = codeOf('proxy.ts')

  test('the session read error is actually looked at', () => {
    assert.match(src, /const \{ data, error \} = await sb\.from\('pin_sessions'\)/,
      'The error must be destructured, or a failed read looks like an expired session.')
  })

  test('a failed read does not clear the cookie', () => {
    const guard = src.indexOf('if (error)')
    const expired = src.indexOf('if (!data)')
    assert.ok(guard > 0 && guard < expired,
      'The failure branch must come before the expiry branch.')
    const block = src.slice(guard, expired)
    assert.ok(!/cookies\.set\('cce_session'/.test(block),
      'Clearing the cookie on a read failure forces a needless re-authentication.')
  })

  test('it still fails closed — nobody is let through unverified', () => {
    const guard = src.indexOf('if (error)')
    const block = src.slice(guard, src.indexOf('if (!data)'))
    assert.ok(!/return pass\(\)/.test(block), 'An unverifiable session must never pass.')
    assert.match(block, /status: 503/)
  })

  test('and it does not send them to sign in again', () => {
    /*
     * /login does not return a still-valid session to where it came from, so
     * redirecting there costs the re-authentication this fix exists to avoid.
     * Refusing the one request leaves them on the address they asked for.
     */
    const block = src.slice(src.indexOf('if (error)'), src.indexOf('if (!data)'))
    assert.ok(!/goto\('\/login/.test(block))
    assert.match(src, /RETRY_PAGE/)
  })

  test('a genuinely expired session is still cleared and still says so', () => {
    const expired = src.slice(src.indexOf('if (!data)'))
    assert.match(expired.slice(0, 500), /cookies\.set\('cce_session', ''/)
    assert.match(expired.slice(0, 500), /expired/i)
  })
})

/**
 * ─── 3. A LEAD WEBHOOK IS NOT A PUBLIC MESSAGE PUMP ─────────────────────────
 *
 * Posting to these lands in intakeLead -> autoAssignLead -> onLeadAssigned,
 * which sends the welcome pack and opening WhatsApp to `lead.phone` — the
 * number in the body. /website and /linkedin had no check at all, and
 * /google's looked like one but rejected only a WRONG key:
 *
 *     if (key && body.google_key && body.google_key !== key)
 *
 * Omitting google_key made the middle term false and skipped the test. The
 * way past the lock was to not touch it.
 */
describe('inbound lead webhooks are guarded', () => {
  const SOURCES = ['website', 'linkedin', 'google']

  for (const source of SOURCES) {
    test(`${source} runs the guard before creating anything`, () => {
      const src = codeOf(`app/api/webhooks/${source}/route.ts`)
      assert.match(src, /guardLeadWebhook\(/, `${source} is unguarded.`)
      const guard = src.indexOf('guardLeadWebhook(')
      const intake = src.indexOf('intakeLead(')
      assert.ok(guard > 0 && guard < intake,
        `${source} creates the lead before checking who is calling.`)
      assert.match(src, /if \(!guard\.ok\) return guard\.response/)
    })
  }

  test('a configured secret is mandatory, not merely checked when offered', () => {
    const src = codeOf('lib/webhooks/leadGuard.ts')
    assert.match(src, /if \(secret\) \{/,
      'The CONFIGURED secret must drive the check, never the supplied one.')
    assert.match(src, /if \(!supplied \|\| !sameSecret\(supplied, secret\)\)/,
      'A missing key must be rejected exactly like a wrong one.')
  })

  test('the old bypassable form is gone from google', () => {
    const src = codeOf('app/api/webhooks/google/route.ts')
    assert.ok(!/body\.google_key &&/.test(src),
      'The `&& body.google_key &&` clause is what made the lock optional.')
  })

  test('secrets are compared in constant time', () => {
    assert.match(codeOf('lib/webhooks/leadGuard.ts'), /timingSafeEqual/)
  })

  test('throttling applies even when no secret is configured', () => {
    /*
     * This is what actually protects today, because the secrets are not set
     * yet. Requiring one that nobody has configured would stop real enquiries
     * from the live website, which is worse than the abuse it prevents.
     */
    const src = codeOf('lib/webhooks/leadGuard.ts')
    const secretBlock = src.slice(src.indexOf('if (secret) {'), src.indexOf('const ip ='))
    assert.ok(!secretBlock.includes('return { ok: true }'),
      'The throttle must not sit behind the secret check.')
    assert.match(src, /rateLimit\(`lead_webhook:/)
  })
})

/**
 * ─── 4. COUNTERS SURVIVE TWO PEOPLE AT ONCE ─────────────────────────────────
 */
describe('campaign counters are atomic', () => {
  test('no counter is incremented by a read-then-write any more', () => {
    for (const file of [
      'app/api/flyers/public/route.ts',
      'app/api/flyers/submit/route.ts',
      'app/api/referrals/submit/route.ts',
    ]) {
      const src = codeOf(file)
      assert.ok(!/\.update\(\{\s*(clicks|leads|referrals_count):/.test(src),
        `${file} still writes a counter it read separately.`)
      assert.match(src, /bumpCounter\(/, `${file} must use the atomic helper.`)
    }
  })

  test('the helper degrades instead of silently stopping', () => {
    /*
     * Code deploys before migrations run. A missing function must keep
     * counting the old way — lossy, which is what it already was — rather
     * than losing every count until somebody runs the SQL. Same precedent as
     * rateLimit with auth_throttle_hit.
     */
    const src = codeOf('lib/db/counter.ts')
    assert.match(src, /does not exist\|could not find\|schema cache/)
    assert.match(src, /legacyBump/)
    assert.match(src, /0018_atomic_counters\.sql/)
  })

  test('even the fallback refuses to write a total it could not read', () => {
    const src = codeOf('lib/db/counter.ts')
    assert.match(src, /if \(error \|\| !data\) return null/,
      'That was the other half of the bug: an unreadable row written back as 1.')
  })

  test('the migration only allows the three real counters', () => {
    const sql = readFileSync('supabase/migrations/0018_atomic_counters.sql', 'utf8')
    assert.match(sql, /p_table = 'flyers'\s+AND p_column IN \('clicks', 'leads'\)/)
    assert.match(sql, /p_table = 'referral_codes'\s+AND p_column = 'referrals_count'/)
    assert.match(sql, /RAISE EXCEPTION/,
      'Anything outside the allowlist must be refused, not interpolated.')
    assert.match(sql, /COALESCE\(%I, 0\)/,
      'NULL + 1 is NULL, which would erase a count rather than raise it.')
  })
})
