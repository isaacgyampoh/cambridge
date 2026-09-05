#!/usr/bin/env node
/**
 * Deployment preflight.
 *
 * Run this BEFORE deploying, and again after, against the environment you are
 * deploying to:
 *
 *   node scripts/preflight.mjs
 *
 * It answers one question: would this build actually work if it went live?
 *
 * That question matters more than usual here, because the security work
 * removed every hardcoded credential fallback. Before, a missing environment
 * variable silently fell back to a key committed in the repository; now it
 * throws. That is the correct behaviour, but it means a deploy with an
 * incomplete environment is not a degraded app — it is an app where nobody can
 * sign in and no server route works at all.
 *
 * Nothing here writes. It reads environment variables and asks the database
 * which functions exist.
 */

const REQUIRED_ENV = [
  ['SUPABASE_SERVICE_KEY', 'Every server route. Without it the proxy refuses all authenticated traffic.'],
  ['PIN_PEPPER', 'Staff sign-in and session tokens. Without it every login throws.'],
  ['CRON_SECRET', 'All scheduled jobs — reminders, SMS retries, reports.'],
  ['SETUP_SECRET', 'The one-time bootstrap endpoints.'],
  ['PAYSTACK_SECRET_KEY', 'Payment webhook signature verification. Without it every webhook is refused.'],
  ['ARKESEL_API_KEY', 'All SMS.'],
]

const REQUIRED_PUBLIC_ENV = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'Falls back to the known project URL, but should be explicit.', true],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Falls back to the published anon key, but should be explicit.', true],
  ['NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY', 'Payment initialisation. NO fallback — payments break without it.', false],
  ['NEXT_PUBLIC_APP_URL', 'Links in emails, WhatsApp messages and QR codes.', true],
]

/** Database objects the application calls. A missing one is a runtime failure. */
const REQUIRED_FUNCTIONS = [
  ['auth_throttle_hit', '0001', 'Login rate limiting (fails OPEN if absent — logged, not fatal)'],
  ['auth_throttle_reset', '0001', 'Clearing a throttle after a good login'],
  ['assign_lead_atomic', '0002', 'Lead assignment. Absent → no lead is ever auto-assigned.'],
  ['assign_lead_to', '0002', 'Manual assignment and referral-link ownership.'],
  ['bump_lead_pending', '0002', 'Pending-lead SMS counter.'],
  ['claim_due_sms', '0003', 'SMS retry queue. Absent → failed messages are never retried.'],
  ['claim_event', '0004', 'Payment webhook idempotency. Absent → every webhook returns 503.'],
  ['record_payment_once', '0004', 'Recording a payment exactly once.'],
  ['apply_fee_payment', '0004', 'Atomic fee balance increment.'],
  ['next_admission_number', '0005', 'Collision-free admission numbers.'],
  ['prune_old_logs', '0007', 'Nightly log retention. Absent → webhook_inbox grows unbounded.'],
]

const REQUIRED_TABLES = [
  ['auth_throttle', '0001'],
  ['lead_assignments', '0002'],
  ['processed_events', '0004'],
  ['message_jobs', '0004'],
]

const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
}

let failures = 0
let warnings = 0

function head(title) {
  console.log('\n' + c.bold(title))
  console.log(c.dim('─'.repeat(title.length)))
}

// ── 1. Environment ──────────────────────────────────────────────────────────
head('Required server secrets')
for (const [name, why] of REQUIRED_ENV) {
  if (process.env[name]) {
    console.log(`  ${c.green('OK')}    ${name}`)
  } else {
    failures++
    console.log(`  ${c.red('MISSING')} ${name}`)
    console.log(`          ${c.dim(why)}`)
  }
}

head('Public configuration')
for (const [name, why, hasFallback] of REQUIRED_PUBLIC_ENV) {
  if (process.env[name]) {
    console.log(`  ${c.green('OK')}    ${name}`)
  } else if (hasFallback) {
    warnings++
    console.log(`  ${c.yellow('DEFAULT')} ${name}`)
    console.log(`          ${c.dim(why)}`)
  } else {
    failures++
    console.log(`  ${c.red('MISSING')} ${name}`)
    console.log(`          ${c.dim(why)}`)
  }
}

// ── 2. Database ─────────────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  head('Database')
  console.log(`  ${c.yellow('SKIPPED')} Cannot reach the database without SUPABASE_SERVICE_KEY.`)
  warnings++
} else {
  head('Database migrations')
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url, key)

  /*
   * Functions are checked against PostgREST's own OpenAPI description, which
   * lists every RPC it exposes.
   *
   * The obvious approach — call each function and see whether it errors — does
   * not work, and gave confident false negatives when this script was first
   * written: calling a function with no arguments fails to match its signature,
   * so PostgREST reports "Could not find the function in the schema cache",
   * which is indistinguishable from the function genuinely not existing. Every
   * function taking required parameters was reported MISSING while sitting
   * happily in the database.
   */
  let exposed = null
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (res.ok) {
      const spec = await res.json()
      exposed = new Set(
        Object.keys(spec.paths || {})
          .filter(p => p.startsWith('/rpc/'))
          .map(p => p.slice('/rpc/'.length))
      )
    }
  } catch { /* fall through to the per-call probe below */ }

  for (const [fn, migration, why] of REQUIRED_FUNCTIONS) {
    let present
    if (exposed) {
      present = exposed.has(fn)
    } else {
      // Fallback when the OpenAPI description is unavailable: a call that
      // reaches the function proves it exists, whatever it then complains about.
      const { error } = await sb.rpc(fn, {})
      present = !(error && /could not find|does not exist|schema cache/i.test(error.message))
    }

    if (present) {
      console.log(`  ${c.green('OK')}    ${fn}()`)
    } else {
      failures++
      console.log(`  ${c.red('MISSING')} ${fn}()  ${c.dim('← migration ' + migration)}`)
      console.log(`          ${c.dim(why)}`)
    }
  }

  head('Tables')
  for (const [table, migration] of REQUIRED_TABLES) {
    const { error } = await sb.from(table).select('*', { count: 'exact', head: true }).limit(1)
    if (error && /does not exist|schema cache|could not find/i.test(error.message)) {
      failures++
      console.log(`  ${c.red('MISSING')} ${table}  ${c.dim('← migration ' + migration)}`)
    } else {
      console.log(`  ${c.green('OK')}    ${table}`)
    }
  }

  head('Row level security')
  // There is no safe way to enumerate pg_class through PostgREST, so this is
  // the one check that has to be run by hand.
  console.log(`  ${c.dim('Run this in the Supabase SQL editor — it must return NO rows:')}`)
  console.log(c.dim('    SELECT c.relname FROM pg_class c'))
  console.log(c.dim('      JOIN pg_namespace n ON n.oid = c.relnamespace'))
  console.log(c.dim("     WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=FALSE;"))
}

// ── 3. Verdict ──────────────────────────────────────────────────────────────
console.log('')
if (failures > 0) {
  console.log(c.red(c.bold(`✗ NOT READY — ${failures} blocking problem${failures === 1 ? '' : 's'}`)))
  console.log(c.dim('  Deploying now would take the application down. Fix the items above first.'))
  process.exit(1)
}
if (warnings > 0) {
  console.log(c.yellow(c.bold(`⚠ READY, with ${warnings} thing${warnings === 1 ? '' : 's'} to check`)))
  process.exit(0)
}
console.log(c.green(c.bold('✓ READY')))
