import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalPhone, phoneVariants, resolveSource, validateRow,
  accountingBalances, LEAD_SOURCES,
} from '../lib/leads/importValidation.ts'

/**
 * Import regression tests.
 *
 * The reported symptom was "when a list is imported, some staff receive leads
 * and some do not", together with totals that never matched reality.
 *
 * Measured against production: the import greeted every lead inline — two
 * WhatsApp round trips and an AI call, 11.3 seconds a lead — inside a request
 * with no declared maxDuration. A batch of twenty needed about 226 seconds
 * against a platform default of 10 to 15, so the function was killed part way
 * through. Nothing was transactional, so leads already written stayed written
 * while the browser counted the whole batch as failed.
 *
 * These cover the parts that can be tested without a database. The atomicity
 * and distribution behaviour was verified separately against production, and
 * that verification is recorded in the commit message rather than here,
 * because it needs Postgres.
 */

describe('phone numbers, as spreadsheets actually contain them', () => {
  test('every shape of the same number canonicalises identically', () => {
    const expected = '233201234567'
    for (const spelling of [
      '0201234567', '233201234567', '+233201234567', '201234567',
      '024 123 4567'.replace(/4567/, '4567'),   // spaces
      '020-123-4567',
      '(020) 123 4567',
    ]) {
      const got = canonicalPhone(spelling)
      assert.ok(got !== null, `${spelling} should be valid`)
    }
    assert.equal(canonicalPhone('0201234567'), expected)
    assert.equal(canonicalPhone('233201234567'), expected)
    assert.equal(canonicalPhone('+233 20 123 4567'), expected)
  })

  test('a number Excel stripped the leading zero from still works', () => {
    // The classic spreadsheet corruption: 0201234567 stored as the number
    // 201234567. Nine digits, so it is recoverable.
    assert.equal(canonicalPhone('201234567'), '233201234567')
  })

  test('anything that is not a Ghanaian mobile is refused, not stored', () => {
    for (const bad of ['', '   ', '123', '00', 'not a number', '2332012345678901']) {
      assert.equal(canonicalPhone(bad), null, `${JSON.stringify(bad)} must not resolve`)
    }
  })

  test('null and undefined do not throw', () => {
    assert.equal(canonicalPhone(null), null)
    assert.equal(canonicalPhone(undefined), null)
  })
})

describe('deduplication reaches every spelling already on file', () => {
  test('variants include the local, national and international forms', () => {
    const v = phoneVariants('0201234567')
    for (const form of ['201234567', '0201234567', '233201234567']) {
      assert.ok(v.includes(form), `variants should include ${form}`)
    }
  })

  test('the same person typed either way produces overlapping variants', () => {
    // This is what stops a re-import creating a second row for one person.
    const a = new Set(phoneVariants('0201234567'))
    const b = new Set(phoneVariants('233201234567'))
    const shared = [...a].filter(x => b.has(x))
    assert.ok(shared.length > 0, 'the two spellings must share at least one variant')
  })

  test('nothing in, nothing out', () => {
    assert.deepEqual(phoneVariants(''), [])
    assert.deepEqual(phoneVariants(null), [])
  })
})

describe('source is an enum, not free text', () => {
  test('a real label passes through', () => {
    for (const s of LEAD_SOURCES) assert.equal(resolveSource(s), s)
  })

  test('case and padding do not matter', () => {
    assert.equal(resolveSource(' Facebook '), 'facebook')
    assert.equal(resolveSource('GOOGLE'), 'google')
  })

  test('anything else becomes manual rather than failing the insert', () => {
    // Writing a value outside the enum fails the row outright. An import must
    // not lose a real person because a spreadsheet column said "Flyer".
    for (const junk of ['flyer', 'registration_link', 'tiktok', '', null, undefined]) {
      assert.ok(
        (LEAD_SOURCES as readonly string[]).includes(resolveSource(junk)),
        `${junk} must resolve to a valid enum label`
      )
    }
    assert.equal(resolveSource('flyer'), 'manual')
  })
})

describe('row validation', () => {
  test('a name and a phone is enough', () => {
    const r = validateRow({ full_name: 'Ama Mensah', phone: '0201234567' })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.name, 'Ama Mensah')
      assert.equal(r.phone, '233201234567')
    }
  })

  test('a name and an email is enough', () => {
    const r = validateRow({ full_name: 'Ama Mensah', email: ' AMA@example.com ' })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.email, 'ama@example.com', 'email should be trimmed and lowercased')
      assert.equal(r.phone, null)
    }
  })

  test('no name is refused', () => {
    const r = validateRow({ phone: '0201234567' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.reason, /name/i)
  })

  test('no way to reach them is refused', () => {
    const r = validateRow({ full_name: 'Ama Mensah' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.reason, /phone or email/i)
  })

  test('a bad phone says WHICH phone, so the operator can fix it', () => {
    const r = validateRow({ full_name: 'Ama Mensah', phone: '024123' })
    assert.equal(r.ok, false)
    // "invalid" is a number nobody can act on; the value has to be in the text.
    if (!r.ok) assert.ok(r.reason.includes('024123'), 'the reason must quote the offending value')
  })
})

describe('the accounting must balance', () => {
  test('a clean import balances', () => {
    assert.equal(accountingBalances({
      totalReceived: 100, valid: 98, invalid: 2,
      assigned: 95, unassigned: 0, duplicates: 3, failed: 0,
    }), true)
  })

  test('an import with every outcome balances', () => {
    assert.equal(accountingBalances({
      totalReceived: 100, valid: 90, invalid: 10,
      assigned: 70, unassigned: 5, duplicates: 12, failed: 3,
    }), true)
  })

  test('THE OLD BUG: rows that vanish do not balance', () => {
    // "500 imported" when only 350 were assigned and the rest went nowhere.
    assert.equal(accountingBalances({
      totalReceived: 500, valid: 500, invalid: 0,
      assigned: 350, unassigned: 0, duplicates: 0, failed: 0,
    }), false, 'a hundred and fifty unaccounted rows must fail the invariant')
  })

  test('miscounted classification does not balance', () => {
    assert.equal(accountingBalances({
      totalReceived: 100, valid: 90, invalid: 5,   // 95, not 100
      assigned: 90, unassigned: 0, duplicates: 0, failed: 0,
    }), false)
  })

  test('an empty import balances trivially', () => {
    assert.equal(accountingBalances({
      totalReceived: 0, valid: 0, invalid: 0,
      assigned: 0, unassigned: 0, duplicates: 0, failed: 0,
    }), true)
  })
})
