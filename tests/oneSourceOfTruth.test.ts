import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalPhone, phoneVariants, LEAD_SOURCES } from '../lib/leads/importValidation.ts'

/**
 * ONE ANSWER PER QUESTION.
 *
 * Every production bug found in this audit was the same shape: something the
 * system knows, written down in two places, drifting apart in silence.
 *
 *   - apiQuery, copied into five pages, so one missing res.ok check had to be
 *     found five times to be fixed once.
 *   - Lead eligibility asked the portal system; lead visibility asked a
 *     hand-kept list of role names. They disagreed, and leads were assigned
 *     to people the data layer then refused.
 *   - ROLE_DEFAULTS, copied into the staff permissions screen, drifted for
 *     every role — and saving that screen applied the drift.
 *   - canonicalPhone, copied into the registration path without its length
 *     check, wrote phone numbers nobody could ever ring.
 *
 * None of these was visible from the outside. This file is the check.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const ALL = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('hooks')]

/** Files defining a top-level function or const of this name. */
function definedIn(name: string): string[] {
  const re = new RegExp(`^(?:export\\s+)?(?:const|function|async function)\\s+${name}\\b`, 'm')
  return ALL.filter(f => re.test(readFileSync(f, 'utf8')))
}

describe('phone numbers are normalised in one place', () => {
  /*
   * Explicitly asked for: do not duplicate phone-number logic. There had been
   * five normalisers with three different behaviours — and the divergence was
   * not academic. lib/registration/linkLead's canonicalPhone had no length
   * check, so "024123" became "23324123": truthy, so it passed the "no phone
   * and no email" guard, and was written to leads.phone as a new lead.
   *
   * That lead cannot be reached. normaliseRecipient rejects the number, so no
   * SMS and no WhatsApp; and the same person enquiring properly later matches
   * nothing, so they are created again and the marketer's history splits.
   */
  test('canonicalPhone is defined once', () => {
    const where = definedIn('canonicalPhone')
    assert.deepEqual(where, ['lib/leads/importValidation.ts'],
      'a second canonical phone form exists — the last one dropped the ' +
      'length check and stored numbers nobody could ring:\n  ' + where.join('\n  '))
  })

  test('phoneVariants is defined once', () => {
    const where = definedIn('phoneVariants')
    assert.deepEqual(where, ['lib/leads/importValidation.ts'],
      'lead lookup by phone is implemented more than once, so two paths can ' +
      'disagree about whether the same person is already a lead:\n  ' + where.join('\n  '))
  })

  test('a short or overlong number is refused, not stored', () => {
    for (const bad of ['024123', '12345678901234', '0', '233', 'abc']) {
      assert.equal(canonicalPhone(bad), null, `"${bad}" was accepted as a phone number`)
    }
  })

  test('the forms people actually type all canonicalise the same', () => {
    for (const good of ['0241234567', '233241234567', '+233 24 123 4567', '+233241234567', '024 123 4567']) {
      assert.equal(canonicalPhone(good), '233241234567', `"${good}" did not canonicalise`)
    }
  })

  test('what canonicalPhone accepts, the SMS layer can send to', () => {
    /*
     * normaliseRecipient in lib/integrations/sms accepts exactly /^233\d{9}$/
     * and returns null otherwise. Asserting the shape rather than importing
     * it keeps this file free of the `@/` alias, which the test runner does
     * not resolve — but the invariant is the real one: a number good enough
     * to store as a lead must be good enough to text, or the lead is created
     * and then unreachable.
     */
    const DELIVERABLE = /^233\d{9}$/

    for (const n of ['0241234567', '233551234567', '+233201234567', '020 123 4567']) {
      const stored = canonicalPhone(n)
      assert.ok(stored, `${n} was refused at storage`)
      assert.match(stored, DELIVERABLE,
        `${n} can be stored as a lead but not texted — the two rules disagree`)
    }

    // And the sender's rule is still the one being described.
    const sms = readFileSync('lib/integrations/sms.ts', 'utf8')
    assert.match(sms, /\^233\\d\{9\}\$/,
      'the SMS layer no longer accepts what this test assumes it does')
  })

  test('a stored number finds itself again', () => {
    const stored = canonicalPhone('0241234567')!
    assert.ok(phoneVariants('024 123 4567').includes(stored),
      'a lead looked up by the number typed into a form would not match the ' +
      'row written from the same number')
  })
})

describe('access rules are defined once', () => {
  test('ROLE_DEFAULTS lives only in lib/access/portals', () => {
    const where = definedIn('ROLE_DEFAULTS')
    assert.deepEqual(where, ['lib/access/portals.ts'],
      'a second copy of the role defaults exists. The last one had drifted ' +
      'for every role, and the staff permissions screen wrote the drift to ' +
      'the database on save:\n  ' + where.join('\n  '))
  })

  test('FINANCE_ROLES is defined once', () => {
    const where = definedIn('FINANCE_ROLES')
    assert.deepEqual(where, ['lib/access/apiAccess.ts'],
      'the fees API and the AI assistant can disagree about who is finance:' +
      '\n  ' + where.join('\n  '))
  })

  test('LEADS_PORTAL is defined once', () => {
    // Receiving a lead and being allowed to read it must be the same question.
    const where = definedIn('LEADS_PORTAL')
    assert.deepEqual(where, ['lib/data/policy.ts'],
      'lead eligibility and lead visibility read different constants again:' +
      '\n  ' + where.join('\n  '))
  })

  test('LEAD_SOURCES is defined once', () => {
    const where = definedIn('LEAD_SOURCES')
    assert.deepEqual(where, ['lib/leads/importValidation.ts'],
      'two lists of what leads.source may hold — and it is a Postgres enum, ' +
      'so the looser one fails the insert outright:\n  ' + where.join('\n  '))
  })

  test('every source the code will write is one the column accepts', () => {
    // resolveSource in the registration path falls back to these two.
    for (const fallback of ['referral', 'website']) {
      assert.ok((LEAD_SOURCES as readonly string[]).includes(fallback),
        `a registration can be written with source "${fallback}", which the enum rejects`)
    }
  })
})

describe('data is read through one client helper', () => {
  test('apiQuery is defined once', () => {
    const where = definedIn('apiQuery')
    assert.deepEqual(where, ['lib/api/query.ts'],
      'a private copy of apiQuery is back. The last five each swallowed a ' +
      '401 and returned [], drawing reports of zero as though they were ' +
      'real:\n  ' + where.join('\n  '))
  })
})
