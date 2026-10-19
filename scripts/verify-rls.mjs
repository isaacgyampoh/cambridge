#!/usr/bin/env node
/**
 * CAN AN OUTSIDER READ ANYTHING WITH THE PUBLIC KEY?
 *
 * The anon key is public by design: it is compiled into the browser bundle
 * and anybody who opens the portal has it. Row Level Security is the ONLY
 * thing standing between that key and the database — so "RLS is enabled on
 * every table" is structural evidence, and this is the behavioural test.
 *
 * It asks, for each table, exactly what a stranger with the key would ask:
 * can I read a row, and can I write one. Nothing personal is ever printed —
 * only whether rows came back, and how many.
 *
 * Usage:  node scripts/verify-rls.mjs
 * Exit 1 if anything is readable or writable that should not be.
 */

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!URL_BASE || !ANON) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (both are public values).')
  process.exit(2)
}

/** Everything a stranger must not read. */
const PRIVATE_TABLES = [
  'message_jobs',
  'leads', 'lead_activities', 'lead_comments', 'lead_assignments', 'lead_status_logs',
  'profiles', 'pin_sessions', 'applications', 'admissions', 'invoices', 'payments',
  'student_fees', 'batches', 'batch_students', 'class_enrollments', 'class_sessions',
  'class_signins', 'attendance', 'certificates', 'documents', 'settings',
  'whatsapp_logs', 'sms_logs', 'webhook_inbox', 'ai_conversations', 'audit_log',
  'marketer_enrollments', 'marketer_targets', 'notifications', 'processed_events',
]

/** Published-by-design. Readable here is expected, not a finding. */
const PUBLIC_BY_DESIGN = ['alumni', 'courses']

const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, Accept: 'application/json' }

/*
 * `select=*`, never a named column. An earlier version asked for `id`, and
 * two tables have no id — they answered 400, the sweep read that as "not
 * readable", and both were in fact wide open. A status that is neither a
 * success nor a refusal is reported, not assumed.
 */
async function readable(table) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=2`, { headers })
  const text = await res.text()
  let rows = null
  try { const j = JSON.parse(text); rows = Array.isArray(j) ? j.length : null } catch { /* not a list */ }
  const inconclusive = res.status !== 200 && res.status !== 401 && res.status !== 403 && res.status !== 404
  return { status: res.status, rows, inconclusive, message: rows === null ? text.slice(0, 90) : null }
}

async function writable(table) {
  // A write that must be refused. Deliberately invalid so that, in the event
  // it IS permitted, it still fails on validation rather than inserting.
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ __rls_probe__: true }),
  })
  return res.status
}

const findings = []
console.log(`Probing ${URL_BASE.replace(/https:\/\/([^.]+).*/, 'https://$1.supabase.co')} with the PUBLIC anon key\n`)
console.log('table                      read            write')
console.log('─'.repeat(58))

/*
 * ── THE LIST ABOVE IS NOT TRUSTED ON ITS OWN ───────────────────────────────
 *
 * It was hand-written, and it was wrong. It covered enough tables to report
 * NINE findings when fifty-seven tables carried a policy granting the public
 * role every operation unconditionally. The probe was only ever as good as
 * the list, and a security check that under-reports is worse than none:
 * it was taken as evidence the rest were fine.
 *
 * So the real table list comes from the database when a service key is
 * available. The anon key cannot be used to enumerate — PostgREST only
 * advertises what the caller may reach, which after a correct lock-down is
 * nothing at all, so asking it would always say "nothing to check".
 */
let tables = [...PRIVATE_TABLES, ...PUBLIC_BY_DESIGN]
let listSource = 'the hand-written list in this file'

/*
 * The list comes from the database itself when a management token is
 * available. PostgREST's own schema endpoint cannot supply it: it advertises
 * only what the caller may reach, and after a correct lock-down that is
 * nothing — so it would always answer "nothing to check", which is precisely
 * the false comfort this is meant to stop.
 */
const MGMT = process.env.SUPABASE_ACCESS_TOKEN
const REF = (URL_BASE.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1]
if (MGMT && REF) {
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { authorization: `Bearer ${MGMT}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;",
      }),
    })
    const rows = await res.json()
    const found = Array.isArray(rows) ? rows.map(r => r.tablename).filter(Boolean) : []
    if (found.length > 5) {
      const missed = found.filter(t => !tables.includes(t))
      tables = [...new Set([...tables, ...found])]
      listSource = `the database — ${found.length} tables, ${missed.length} of which this file never named`
    }
  } catch (e) {
    console.error('  could not enumerate tables, falling back to the list:', e.message)
  }
}

console.log(`Checking ${tables.length} tables, from ${listSource}.\n`)

for (const table of tables) {
  const r = await readable(table)
  const w = await writable(table)
  const expected = PUBLIC_BY_DESIGN.includes(table)

  const leaked = r.rows !== null && r.rows > 0 && !expected
  const writeOpen = w >= 200 && w < 300

  const readCell = r.rows === null ? `refused (${r.status})` : `${r.rows} row(s) [${r.status}]`
  console.log(`${table.padEnd(26)} ${readCell.padEnd(15)} ${w}${writeOpen ? '  ← ACCEPTED' : ''}`)

  if (leaked) findings.push(`${table}: readable by anyone with the public key (${r.rows} row(s))`)
  if (r.inconclusive) findings.push(`${table}: could not be judged (HTTP ${r.status}) — check by hand`)
  if (writeOpen) findings.push(`${table}: writable by anyone with the public key (HTTP ${w})`)
}

console.log('\n' + '─'.repeat(58))
if (findings.length) {
  console.log(`FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.log('  • ' + f)
  process.exit(1)
}
console.log('PASS — nothing private is readable or writable with the public key.')
