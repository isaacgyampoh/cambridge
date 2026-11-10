import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalGhanaMobile, localGhanaMobile } from '../lib/phone.ts'

/**
 * ONE RULE FOR GHANAIAN NUMBERS, USED BY EVERY DESTINATION.
 *
 * The rule was written out three times — the contact links, the Arkesel
 * recipient, the WaSender recipient. All three turned "00233241234567" into
 * 2330233241234567, because the leading zero of the 00 dialling prefix was
 * rewritten to 233 before anything looked at the 00.
 *
 * Two of the three then validated and returned null, so the number produced
 * no Call button and no WhatsApp link. The third did not validate at all and
 * handed sixteen digits to the provider.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('every way a Ghanaian number is written', () => {
  const expected = '233241234567'
  for (const input of [
    '0241234567', '+233241234567', '233241234567', '00233241234567',
    '+233 24 123 4567', '024 123 4567', '024-123-4567', '(024) 123 4567',
    '+233-24-123-4567', ' 0241234567 ', '024.123.4567',
  ]) {
    test(JSON.stringify(input), () => {
      assert.equal(canonicalGhanaMobile(input), expected)
    })
  }

  test('the other networks too', () => {
    assert.equal(canonicalGhanaMobile('0201234567'), '233201234567')
    assert.equal(canonicalGhanaMobile('0541234567'), '233541234567')
    assert.equal(canonicalGhanaMobile('0501234567'), '233501234567')
  })
})

describe('the country code is never duplicated', () => {
  test('00233 loses the dialling prefix rather than gaining a country code', () => {
    const out = canonicalGhanaMobile('00233241234567')
    assert.equal(out, '233241234567')
    assert.ok(!out!.startsWith('2330'), `produced ${out}`)
    assert.ok(!out!.startsWith('233233'), `produced ${out}`)
  })

  test('an already-canonical number is left alone', () => {
    assert.equal(canonicalGhanaMobile('233241234567'), '233241234567')
  })

  test('nothing ever comes back longer than twelve digits', () => {
    for (const input of ['00233241234567', '+233241234567', '0241234567', '233241234567']) {
      const out = canonicalGhanaMobile(input)
      assert.equal(out?.length, 12, `${input} -> ${out}`)
    }
  })
})

describe('what is not a Ghanaian mobile gets no link and no message', () => {
  for (const bad of ['', '   ', '12345', '+44 7700 900000', '2332412345', '23324123456789', 'abc', null, undefined]) {
    test(JSON.stringify(bad), () => {
      assert.equal(canonicalGhanaMobile(bad as string), null)
    })
  }

  test('null rather than a guess, because both failures are silent', () => {
    // A malformed tel: does nothing when tapped; a malformed recipient is a
    // message that never arrives. An absent button is honest about both.
    assert.equal(localGhanaMobile('nonsense'), null)
  })
})

describe('local display', () => {
  test('a Ghanaian reader sees 0241234567', () => {
    assert.equal(localGhanaMobile('+233241234567'), '0241234567')
    assert.equal(localGhanaMobile('00233241234567'), '0241234567')
  })
})

describe('there is exactly one implementation', () => {
  const copies = [
    'lib/ui/contact.ts',
    'lib/integrations/smsRecipient.ts',
    'lib/integrations/whatsapp.ts',
  ]

  test('all three destinations delegate to it', () => {
    for (const path of copies) {
      assert.match(codeOf(path), /canonicalGhanaMobile/,
        `${path} does not use the shared rule`)
    }
  })

  test('and none of them still carries its own copy', () => {
    for (const path of copies) {
      const src = codeOf(path)
      assert.ok(!/\.replace\(\/\^0\/, '233'\)/.test(src),
        `${path} still rewrites a leading zero itself`)
      assert.ok(!/\^233\\d\{9\}\$/.test(src),
        `${path} still validates with its own copy of the pattern`)
    }
  })

  test('the shared rule strips the dialling prefix before the leading zero', () => {
    /*
     * Order is the whole bug: with the single-zero rule first, "00233…" has
     * the first zero of the dialling prefix rewritten and comes out as a
     * duplicated country code.
     *
     * Asserted on the RESULT rather than on the order of two replace() calls
     * in the source, which is how it was written before: that assertion
     * passed or failed on the shape of the implementation, and failed the
     * day the rule was rewritten correctly.
     */
    assert.equal(canonicalGhanaMobile('00233241234567'), '233241234567')
    assert.equal(canonicalGhanaMobile('00233 (0) 24 123 4567'), '233241234567')
    // The form the old order produced, had anything stored it.
    assert.equal(canonicalGhanaMobile('2330233241234567'), null)
  })

  test('it stays importable by the test runner', () => {
    // lib/ui/contact.ts is unit tested directly and the '@/' alias does not
    // resolve there, so an aliased import would make the file unloadable.
    assert.match(readFileSync('lib/ui/contact.ts', 'utf8'), /from '\.\.\/phone\.ts'/)
  })
})

/**
 * THE NUMBER THAT IS STORED IS THE NUMBER THAT CAN BE TEXTED.
 *
 * ── THE REPORT ─────────────────────────────────────────────────────────────
 *
 * "Staff are not receiving the SMS for a PIN reset."
 *
 * A staff member's phone is where their PIN and their sign-in codes go, and
 * with the campus mailbox unconfigured it is the ONLY place they go. Both
 * screens that write it had their own rule, and neither validated:
 *
 *   create-staff  stripped spaces and nothing else, so "+233 (0) 244 721 555"
 *                 was stored as 233(0)244721555 and "024-472-1555" as
 *                 23324-472-1555 — and the initial PIN is the last four
 *                 digits of that, so a malformed number made a nonsense PIN
 *                 as well.
 *
 *   edit-staff    returned anything already starting 233 untouched, so the
 *                 same number went in as 2330244721555 and passed its only
 *                 check, which was a length of at least twelve.
 *
 * The reader refused all of those, so the account could be created, listed
 * and given a PIN, and could never be sent one. Nothing in the product said
 * so: the administrator saw a PIN set, and the colleague waited.
 */
describe('a staff phone number is canonicalised before it is stored', () => {
  for (const [name, path] of [
    ['create-staff', 'app/api/admin/create-staff/route.ts'],
    ['edit-staff', 'app/api/admin/edit-staff/route.ts'],
  ] as const) {
    describe(name, () => {
      const src = codeOf(path)

      test('it uses the shared rule rather than one of its own', () => {
        assert.match(src, /canonicalGhanaMobile\(phone\)/,
          `${name} does not canonicalise the number it stores`)
        assert.ok(!/'233' \+ \w+\.slice\(1\)/.test(src),
          `${name} still rewrites a leading zero itself`)
        assert.ok(!/digits\.startsWith\('233'\)/.test(src),
          `${name} still waves through anything that begins 233`)
      })

      test('and refuses what the rule cannot read, rather than storing it', () => {
        /*
         * The whole defect in one line. Storing an unreadable number does not
         * fail anything at the time — it fails weeks later, silently, to
         * somebody else, when a PIN is reset and no text arrives.
         */
        assert.match(src, /if \(!phone233\)/,
          `${name} stores the number without checking the rule could read it`)
        assert.match(src, /status: 400/)
        assert.match(src, /Ghanaian mobile number/,
          `${name} does not say what a usable number looks like`)
      })

      test('and it is the canonical value that is written', () => {
        assert.match(src, /phone(?::|.*=)\s*phone233|update\.phone = phone233/,
          `${name} writes something other than the canonical number`)
      })
    })
  }

  test('the forms that cost somebody their PIN all resolve now', () => {
    // Exactly what the two screens were storing.
    assert.equal(canonicalGhanaMobile('2330244721555'), '233244721555')
    assert.equal(canonicalGhanaMobile('233(0)244721555'), '233244721555')
    assert.equal(canonicalGhanaMobile('23324-472-1555'), '233244721555')
    assert.equal(canonicalGhanaMobile('244721555'), '233244721555')
  })

  test('and the ambiguous ones are still refused, because it is a credential', () => {
    assert.equal(canonicalGhanaMobile('0244721555/0501234567'), null)
    assert.equal(canonicalGhanaMobile('0302123456'), null)
    assert.equal(canonicalGhanaMobile('123456789'), null)
    assert.equal(canonicalGhanaMobile('+2348012345678'), null)
  })
})
