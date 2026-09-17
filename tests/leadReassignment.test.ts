import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * A PROJECT MANAGER CAN MOVE A LEAD THAT ALREADY HAS AN OWNER.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * /api/leads/assign has always permitted it: the pm_leads portal is in its
 * guard, and it calls assign_lead_to with p_force, which takes a lead over.
 *
 * The screen never offered it. The Lead inbox rendered the assign column as
 *
 *     l.assignee ? <span>{name}</span> : <select>…</select>
 *
 * so an owned lead showed its owner as plain text. A PM could hand out
 * unclaimed leads and could not move one that was already out — the
 * capability existed and had no control attached to it.
 *
 * ── WHAT A REASSIGNMENT HAS TO RECORD ──────────────────────────────────────
 *
 * It takes a lead, and the commission on it, off somebody. So it is not the
 * same event as assigning an unowned lead and is not recorded as one.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const route = codeOf('app/api/leads/assign/route.ts')
const screen = codeOf('app/(portal)/pm/assign/page.tsx')

describe('the project manager is allowed to do it', () => {
  test('the endpoint admits the PM portal, not only the admin one', () => {
    assert.match(route, /withGuard\(\{ portals: \['leads', 'pm_leads'\] \}/)
  })

  test('and it takes over an owned lead rather than refusing', () => {
    assert.match(route, /p_force: mode !== 'claim'/)
  })

  test('a claim still only works on an unowned lead', () => {
    // Claiming is first-come-first-served; reassigning is deliberate.
    assert.match(route, /p_reason: mode === 'claim' \? 'claim'/)
  })

  test('reassign is an accepted mode', () => {
    assert.match(route, /z\.enum\(\['assign', 'claim', 'reassign'\]\)/)
  })
})

describe('the move is recorded as a move', () => {
  test('the prior owner is read before the write', () => {
    const read = route.indexOf("const { data: priorRow }")
    const write = route.indexOf("rpc('assign_lead_to'")
    assert.ok(read > -1 && read < write, 'the previous owner must be known before it changes')
  })

  test('history says reassign, not manual', () => {
    assert.match(route, /isReassignment \? 'reassign' : 'manual'/)
  })

  test('the audit names who it came off, who it went to, and why', () => {
    assert.match(route, /action: mode === 'claim' \? 'lead\.claimed'/)
    assert.match(route, /isReassignment \? 'lead\.reassigned' : 'lead\.assigned'/)
    assert.match(route, /metadata: \{ to: marketerId, from: prior, reason: note \|\| null \}/)
  })

  test('and the lead’s own timeline carries it, where the people involved read', () => {
    assert.match(route, /subject: 'Lead reassigned'/)
    assert.match(route, /activity_type: 'note'/)
    assert.match(route, /Moved from \$\{fromWho\?\.full_name/)
  })

  test('a failed note does not undo a committed assignment', () => {
    const block = route.slice(route.indexOf('if (isReassignment) {'))
    assert.match(block.slice(0, 900), /console\.error\('\[leads\/assign\] could not record the reassignment note/)
    assert.ok(!/throw|return NextResponse/.test(block.slice(0, 700)),
      'the note is best effort; the assignment is already done')
  })

  test('the reason is bounded, so it cannot be used as free storage', () => {
    assert.match(route, /note: z\.string\(\)\.trim\(\)\.max\(400\)\.optional\(\)/)
  })
})

describe('the safeguards on assignment still apply', () => {
  test('a lead cannot be moved to somebody who cannot receive leads', () => {
    const guard = route.indexOf('isEligible(marketerId)')
    const write = route.indexOf("rpc('assign_lead_to'")
    assert.ok(guard > -1 && guard < write, 'eligibility must be checked before the write')
  })

  test('the write is still the single locked path', () => {
    // Not a PATCH on leads followed by a call — that combination is what
    // previously left assign_lead_to with nothing to change.
    const before = route.slice(0, route.indexOf("rpc('assign_lead_to'"))
    assert.ok(!/from\('leads'\)[\s\S]{0,120}\.update\(/.test(before),
      'nothing may write leads.assigned_to before the locked call')
  })

  test('a lost race is reported, not overwritten silently', () => {
    assert.match(route, /alreadyAssigned: true/)
    assert.match(route, /status: 409/)
  })
})

describe('the screen offers it', () => {
  test('an owned lead now has a control, not just a name', () => {
    assert.match(screen, /Reassign\s*\n?\s*<\/button>/)
    assert.match(screen, /onClick=\{\(\) => \{ setMoving\(l\); setMoveTo\(''\); setMoveWhy\(''\) \}\}/)
  })

  test('it asks who and why before doing anything', () => {
    assert.match(screen, /<Modal open=\{!!moving\}/)
    assert.match(screen, /Reason \(optional\)/)
    assert.match(screen, /disabled=\{!moveTo \|\| assigning === moving\?\.id\}/,
      'the confirm must be inert until a recipient is chosen')
  })

  test('it names who currently holds the lead', () => {
    assert.match(screen, /moving\?\.assignee\?\.full_name/)
  })

  test('the current owner is not offered as the new owner', () => {
    assert.match(screen, /\.filter\(m => m\.id !== moving\?\.assigned_to\)/)
  })

  test('it sends the reassign mode and the reason', () => {
    const fn = screen.slice(screen.indexOf('async function reassign()'))
    assert.match(fn.slice(0, 1200), /mode: 'reassign'/)
    assert.match(fn.slice(0, 1200), /note: moveWhy\.trim\(\) \|\| undefined/)
  })

  test('it uses the one endpoint, not a second assignment path', () => {
    const fn = screen.slice(screen.indexOf('async function reassign()'))
    assert.match(fn.slice(0, 1200), /fetch\('\/api\/leads\/assign'/)
    assert.ok(!/mutate\('PATCH', 'leads'/.test(fn.slice(0, 1200)),
      'the screen must not write leads.assigned_to itself')
  })

  test('a refusal is surfaced, never announced as success', () => {
    const fn = screen.slice(screen.indexOf('async function reassign()'))
    assert.match(fn.slice(0, 1400), /if \(!res\.ok \|\| !d\?\.success\)/)
    assert.match(fn.slice(0, 1400), /toast\.error\(d\?\.error/)
  })

  test('the control clears the touch-target floor', () => {
    const btn = screen.slice(screen.indexOf('aria-label={`Reassign'))
    assert.ok(/min-h-\[44px\]/.test(screen.slice(screen.indexOf('setMoving(l)') - 400, screen.indexOf('setMoving(l)') + 400)),
      'the Reassign control must be at least 44px on a phone')
    assert.ok(btn.length > 0)
  })

  test('and it says what it is for a screen reader', () => {
    assert.match(screen, /aria-label=\{`Reassign \$\{l\.full_name\}, currently with \$\{l\.assignee\.full_name\}`\}/)
  })
})
