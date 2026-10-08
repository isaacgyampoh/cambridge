#!/usr/bin/env node
/**
 * WHERE ARE THE OLD FEES COMING FROM?
 *
 * Isaac reported that the system still sends old fees. The code reads fees
 * from the course record, so a superseded figure reaching a student means the
 * figure is stored somewhere, not computed somewhere. There are three places
 * it can be stored, and this reports all three.
 *
 *   1. student_fees.total_fee  — a snapshot taken when the student enrolled.
 *      It does NOT follow a later change to the course fee, by design: a
 *      student who agreed GHS 4,950 should not silently owe 5,950. But a row
 *      that was wrong when written, or written from a stale course row, keeps
 *      quoting that figure in every balance and every reminder.
 *
 *   2. knowledge_base / faqs — free text. The money guard permits any amount
 *      that appears here, so an FAQ still naming an old fee lets the
 *      assistant quote it as current.
 *
 *   3. courses.course_fee itself — if the current fee is simply not what the
 *      centre charges today, everything downstream is wrong together.
 *
 * Nothing is changed and no amount is attributed to a named student: each
 * finding is a row id and the figures, so it can be corrected by hand.
 *
 * Usage:  source ~/.zshrc && node scripts/verify-fees.mjs
 *         (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY)
 */

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_BASE || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY.')
  console.error('The service key is needed because these tables are behind RLS. Do not paste it anywhere else.')
  process.exit(2)
}

const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, accept: 'application/json' }

async function get(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers })
  const text = await res.text()
  if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 200) }
  try { return { ok: true, rows: JSON.parse(text) } }
  catch { return { ok: false, status: res.status, detail: 'response was not JSON' } }
}

const money = n => `GHS ${Number(n).toLocaleString()}`
const canon = v => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? String(Math.round(n)) : null
}

let problems = 0
const inconclusive = []

// ── 1. The current course fees ─────────────────────────────────────────────
const courses = await get('courses?select=id,name,course_fee,course_fee_online,registration_fee,is_active')
if (!courses.ok) {
  console.error(`FAIL  courses could not be read (HTTP ${courses.status}): ${courses.detail}`)
  process.exit(1)
}

const active = courses.rows.filter(c => c.is_active !== false)
console.log(`\nCURRENT COURSE FEES  (${active.length} active)`)
console.log('─'.repeat(72))
const backed = new Set()
const feeOf = new Map()
for (const c of active) {
  const inp = c.course_fee, onl = c.course_fee_online
  for (const f of [c.course_fee, c.course_fee_online, c.registration_fee]) {
    const k = canon(f); if (k) backed.add(k)
  }
  feeOf.set(c.id, { name: c.name, inPerson: inp, online: onl })
  const missing = inp === null && onl === null
  if (missing) problems++
  console.log(
    `  ${missing ? 'WARN ' : '     '}${String(c.name).slice(0, 34).padEnd(34)}` +
    ` in person ${inp === null ? '—' : money(inp)}   online ${onl === null ? '—' : money(onl)}` +
    (missing ? '   ← no fee recorded' : ''),
  )
}

// ── 2. Student fee snapshots that disagree with the course ─────────────────
const fees = await get('student_fees?select=id,student_name,course_id,total_fee,amount_paid,created_at&limit=5000')
console.log(`\nSTUDENT FEE SNAPSHOTS vs THE COURSE FEE TODAY`)
console.log('─'.repeat(72))
if (!fees.ok) {
  inconclusive.push(`student_fees could not be read (HTTP ${fees.status}): ${fees.detail}`)
  console.log(`  INCONCLUSIVE — ${fees.status}: ${fees.detail}`)
} else {
  const rows = fees.rows
  let differing = 0, noCourse = 0
  const byFigure = new Map()
  for (const f of rows) {
    if (!f.course_id || !feeOf.has(f.course_id)) { noCourse++; continue }
    const course = feeOf.get(f.course_id)
    const total = canon(f.total_fee)
    const matches = [course.inPerson, course.online].map(canon).filter(Boolean)
    if (total && matches.length && !matches.includes(total)) {
      differing++
      const k = `${course.name} :: ${money(f.total_fee)} (course: ${matches.map(m => money(m)).join(' / ')})`
      byFigure.set(k, (byFigure.get(k) || 0) + 1)
    }
  }
  console.log(`  ${rows.length} fee rows read.`)
  if (noCourse) console.log(`  ${noCourse} have no matching course row — their balance cannot be checked.`)
  if (differing === 0) {
    console.log('  OK   every snapshot matches a current course fee.')
  } else {
    problems++
    console.log(`  WARN ${differing} snapshot${differing === 1 ? '' : 's'} quote a figure that is not a current course fee.`)
    console.log('       A snapshot SHOULD keep the agreed price, so this is not automatically wrong —')
    console.log('       but it is where an old fee reaches a student. Grouped:')
    for (const [k, n] of [...byFigure.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`         ${String(n).padStart(4)} ×  ${k}`)
    }
  }
}

// ── 3. Amounts asserted in the knowledge base ──────────────────────────────
console.log(`\nAMOUNTS WRITTEN IN THE KNOWLEDGE BASE`)
console.log('─'.repeat(72))
const MONEY_RE = /(?:GH₵|GH¢|GHS|GHC|₵)\s*([\d][\d,]*(?:\.\d+)?)|([\d][\d,]*(?:\.\d+)?)\s*(?:cedis|cedi)/gi
let anyText = false
for (const [table, cols] of [['knowledge_base', 'id,category,answer'], ['faqs', 'id,question,answer']]) {
  const r = await get(`${table}?select=${cols}&limit=2000`)
  if (!r.ok) {
    inconclusive.push(`${table} could not be read (HTTP ${r.status}): ${r.detail}`)
    console.log(`  INCONCLUSIVE  ${table} — ${r.status}: ${r.detail}`)
    continue
  }
  anyText = true
  let flagged = 0
  for (const row of r.rows) {
    const text = [row.question, row.answer].filter(Boolean).join(' ')
    const found = []
    for (const m of text.matchAll(MONEY_RE)) {
      const k = canon(m[1] ?? m[2])
      if (k && !backed.has(k) && !found.includes(k)) found.push(k)
    }
    if (found.length) {
      flagged++
      problems++
      console.log(`  WARN  ${table} ${row.id}: ${found.map(f => money(f)).join(', ')} — no course fee backs this`)
      console.log(`        "${text.replace(/\s+/g, ' ').slice(0, 96)}…"`)
    }
  }
  if (!flagged) console.log(`  OK    ${table}: every amount matches a current course fee.`)
}
if (!anyText) console.log('  Neither table could be read, so nothing here was checked.')

// ── Verdict ────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72))
if (inconclusive.length) {
  console.log('INCONCLUSIVE — these were not checked, so this run cannot clear them:')
  for (const i of inconclusive) console.log(`  · ${i}`)
}
if (problems === 0 && inconclusive.length === 0) {
  console.log('PASS — no stale fee figure found in any of the three places.')
  process.exit(0)
}
console.log(`${problems} thing${problems === 1 ? '' : 's'} to look at.`)
console.log('A snapshot keeping an agreed price is legitimate. A knowledge-base line')
console.log('naming a fee that is no longer charged is not: the assistant may quote it.')
process.exit(problems ? 1 : 2)
