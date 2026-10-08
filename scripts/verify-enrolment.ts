#!/usr/bin/env node
/**
 * WHICH ENROLMENT TABLE IS REAL, AND CAN THE TWO BE JOINED?
 *
 * There are two models for "this student is in this class":
 *
 *   class_enrollments  keyed by lead_id   — written, and read by the magic-link
 *                                            student portal, the ten-minute
 *                                            class reminder and material release
 *   batch_students     keyed by profiles.id — read by NINE features and written
 *                                            by NOTHING: no insert anywhere in
 *                                            app/, lib/ or scripts/, no seed and
 *                                            no trigger
 *
 * So those nine features cannot work, and they fail silently: an empty roster
 * is indistinguishable from "this class has no students". Among them is
 * /api/student/next-class, which answers "not_enrolled" to everybody.
 *
 * Repointing them to class_enrollments needs a join from a student-role
 * profile to a lead, and the only candidate column both carry is the phone
 * number. Joining people by phone can put one student's fees in front of
 * another, so it is not something to assume. This measures whether the join
 * would even work before anyone commits to it.
 *
 * Reads only. Prints counts and match rates, never a name or a number.
 *
 * Usage:  source ~/.zshrc && node scripts/verify-enrolment.ts
 */

/*
 * The REAL normaliser, imported rather than copied. A first draft of this
 * script mirrored it by hand and the copy was already wrong — it accepted a
 * bare nine-digit number that lib/phone.ts rejects, which would have
 * over-reported the match rate this whole script exists to measure. There is
 * one canonical normaliser; scripts use it too.
 *
 * Node 24 runs TypeScript directly, so this file is .ts for that reason alone.
 */
import { canonicalGhanaMobile } from '../lib/phone.ts'

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_BASE || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY.')
  process.exit(2)
}

const headers = { apikey: KEY, authorization: `Bearer ${KEY}`, accept: 'application/json' }

async function rows(path: string) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { ...headers, prefer: 'count=exact' },
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, 160) }
  const range = res.headers.get('content-range') || ''
  const total = Number(String(range).split('/')[1])
  try {
    return { ok: true, data: JSON.parse(text), total: Number.isFinite(total) ? total : null }
  } catch {
    return { ok: false, status: res.status, detail: 'response was not JSON' }
  }
}

const inconclusive: string[] = []
const report = (label: string, r: any) => {
  if (r.ok) return true
  inconclusive.push(`${label}: HTTP ${r.status} — ${r.detail}`)
  console.log(`  INCONCLUSIVE  ${label} — ${r.status}: ${r.detail}`)
  return false
}

console.log('\nTHE TWO ENROLMENT MODELS')
console.log('─'.repeat(70))

const bs = await rows('batch_students?select=id,student_id,batch_id&limit=2000')
if (report('batch_students', bs)) {
  console.log(`  batch_students      ${String(bs.total ?? bs.data.length).padStart(6)} rows   (nine readers, no writer)`)
}
const ce = await rows('class_enrollments?select=id,lead_id,batch_id,phone&limit=5000')
if (report('class_enrollments', ce)) {
  console.log(`  class_enrollments   ${String(ce.total ?? ce.data.length).padStart(6)} rows   (written; the live roster)`)
}

if (bs.ok && ce.ok) {
  const bsN = bs.total ?? bs.data.length
  const ceN = ce.total ?? ce.data.length
  console.log('')
  if (bsN === 0 && ceN > 0) {
    console.log('  CONFIRMED  batch_students is empty while class_enrollments is not.')
    console.log('             Every feature reading batch_students shows nothing, and')
    console.log('             says so as though the class were simply empty.')
  } else if (bsN > 0) {
    console.log(`  batch_students holds ${bsN} rows, so something wrote them — not this`)
    console.log('  application. Find out what, before repointing anything.')
  }
}

console.log('\nCOULD THE TWO BE JOINED BY PHONE?')
console.log('─'.repeat(70))

const profs = await rows("profiles?select=id,phone&role=eq.student&limit=5000")
if (report('student-role profiles', profs) && ce.ok) {
  const byPhone = new Map<string, number>()
  let ceNoPhone = 0
  for (const r of ce.data) {
    const p = canonicalGhanaMobile(r.phone)
    if (!p) { ceNoPhone++; continue }
    byPhone.set(p, (byPhone.get(p) || 0) + 1)
  }

  let matched = 0, unmatched = 0, ambiguous = 0, noPhone = 0
  for (const p of profs.data) {
    const c = canonicalGhanaMobile(p.phone)
    if (!c) { noPhone++; continue }
    const n = byPhone.get(c) || 0
    if (n === 0) unmatched++
    else if (n === 1) matched++
    else ambiguous++
  }

  const total = profs.total ?? profs.data.length
  console.log(`  ${total} profiles with role 'student'.`)
  console.log(`    ${String(matched).padStart(5)} match exactly one class_enrollments row by phone`)
  console.log(`    ${String(unmatched).padStart(5)} match none`)
  console.log(`    ${String(ambiguous).padStart(5)} match MORE THAN ONE  ← each one is a chance to show`)
  console.log(`          a student somebody else's class and balance`)
  console.log(`    ${String(noPhone).padStart(5)} have no usable Ghana mobile number`)
  if (ceNoPhone) console.log(`  ${ceNoPhone} class_enrollments rows have no usable number either.`)

  console.log('')
  if (ambiguous > 0) {
    console.log('  DO NOT join on phone. Some numbers belong to more than one enrolment,')
    console.log('  and a phone join would hand one student another\'s record.')
  } else if (matched === 0) {
    console.log('  A phone join would match nobody. The two tables describe different')
    console.log('  populations, and repointing the readers would not help.')
  } else if (unmatched === 0 && noPhone === 0) {
    console.log('  A phone join is clean on today\'s data. It is still a join on a mutable')
    console.log('  field: a student who changes number silently changes record. If this')
    console.log('  route is taken, write the resolved id down once rather than joining')
    console.log('  on every read.')
  } else {
    console.log(`  A phone join would work for ${matched} and leave ${unmatched + noPhone} without a class.`)
    console.log('  Those would see "no upcoming class" and have no way to tell it is wrong.')
  }
}

console.log('\n' + '═'.repeat(70))
if (inconclusive.length) {
  console.log('INCONCLUSIVE — not checked, so this run cannot clear them:')
  for (const i of inconclusive) console.log(`  · ${i}`)
  process.exit(2)
}
console.log('This is a decision, not a defect to patch: which table owns a class')
console.log('roster. See Trello CB-032.')
process.exit(0)
