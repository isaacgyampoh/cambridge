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
    // Order is the whole bug. Asserted on the source so a reordering is caught
    // even if some future input happens to survive it.
    const src = codeOf('lib/phone.ts')
    assert.ok(src.indexOf(".replace(/^00/, '')") < src.indexOf(".replace(/^0/, '233')"),
      'the 00 prefix must be removed before the single-zero rule runs')
  })

  test('it stays importable by the test runner', () => {
    // lib/ui/contact.ts is unit tested directly and the '@/' alias does not
    // resolve there, so an aliased import would make the file unloadable.
    assert.match(readFileSync('lib/ui/contact.ts', 'utf8'), /from '\.\.\/phone\.ts'/)
  })
})
