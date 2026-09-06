import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import {
  PIN_LENGTH, OTP_LENGTH, PIN_PATTERN, OTP_PATTERN,
  isValidPin, isValidOtp, pinRejectionReason, generatePin,
} from '../lib/auth/pinPolicy.ts'

/**
 * THE PIN POLICY — EXACTLY FOUR DIGITS, EVERYWHERE.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * The rule was restated in eight places with three different answers:
 * /^\d{4,8}$/ in verify-pin and change-pin, /^\d{4,6}$/ in the staff
 * endpoints, and a sign-in form whose boxes grew to eight. Account recovery
 * then issued an eight-digit PIN that the four-box form could not accept, so
 * recovery had never worked at all.
 *
 * Each of those was locally reasonable. Only together were they wrong. These
 * tests pin the policy AND check that no file quietly restates it.
 *
 * PIN and OTP are separate concepts with separate lengths. Conflating them is
 * how the confusion started, so both are asserted here.
 */

describe('a PIN is exactly four digits', () => {
  test('the policy says four', () => {
    assert.equal(PIN_LENGTH, 4)
  })

  test('four digits are accepted', () => {
    for (const pin of ['1024', '5009', '7391', '9081', '4702']) {
      assert.equal(isValidPin(pin), true, `${pin} was refused`)
    }
  })

  test('three, five, six and eight digits are all refused', () => {
    for (const pin of ['123', '10245', '102456', '10245678', '1', '', '12345678']) {
      assert.equal(isValidPin(pin), false, `${pin} was accepted`)
    }
  })

  test('letters, symbols and whitespace are refused', () => {
    for (const pin of ['abcd', '10a4', '10 4', '1.24', '+123', '１０２４', ' 1024', '1024 ']) {
      assert.equal(isValidPin(pin), false, `${JSON.stringify(pin)} was accepted`)
    }
  })

  test('non-strings are refused', () => {
    for (const pin of [1024, null, undefined, {}, [], true]) {
      assert.equal(isValidPin(pin), false, `${String(pin)} was accepted`)
    }
  })

  test('the pattern anchors both ends, so a longer string cannot slip through', () => {
    assert.equal(PIN_PATTERN.test('1024'), true)
    assert.equal(PIN_PATTERN.test('10245'), false)
    assert.equal(PIN_PATTERN.test('x1024'), false)
    assert.equal(PIN_PATTERN.test('1024\n5678'), false)
  })
})

describe('an OTP is a different thing from a PIN', () => {
  test('the OTP length is six and is not the PIN length', () => {
    assert.equal(OTP_LENGTH, 6)
    assert.notEqual(OTP_LENGTH, PIN_LENGTH)
  })

  test('a four-digit value is not a valid OTP', () => {
    assert.equal(isValidOtp('1024'), false)
    assert.equal(isValidOtp('102456'), true)
    assert.equal(OTP_PATTERN.test('1024567'), false)
  })
})

describe('weak PINs are refused wherever a PIN is set', () => {
  test('repeated digits', () => {
    for (const pin of ['0000', '1111', '9999']) {
      assert.ok(pinRejectionReason(pin), `${pin} was allowed`)
    }
  })

  test('runs up and down', () => {
    for (const pin of ['1234', '4321', '2345', '9876']) {
      assert.ok(pinRejectionReason(pin), `${pin} was allowed`)
    }
  })

  test('the usual keypad patterns', () => {
    for (const pin of ['2580', '1212', '1122']) {
      assert.ok(pinRejectionReason(pin), `${pin} was allowed`)
    }
  })

  test('a wrong length is refused with a length message, not a weakness one', () => {
    assert.match(pinRejectionReason('123')!, /exactly 4 digits/)
    assert.match(pinRejectionReason('12345')!, /exactly 4 digits/)
  })

  test('an ordinary PIN is allowed', () => {
    for (const pin of ['1024', '5009', '7391', '4702', '8153']) {
      assert.equal(pinRejectionReason(pin), null, `${pin} was refused`)
    }
  })
})

describe('a generated PIN is always usable', () => {
  test('every generated PIN is four digits and passes the policy', () => {
    // Deterministic sequence, so a failure is reproducible.
    let seed = 7
    const rng = (min: number, max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return min + (seed % (max - min))
    }
    for (let i = 0; i < 300; i++) {
      const pin = generatePin(rng)
      assert.equal(pin.length, PIN_LENGTH)
      assert.equal(isValidPin(pin), true)
      assert.equal(pinRejectionReason(pin), null,
        `generated ${pin}, which the policy would then refuse`)
    }
  })
})

/* ─────────────────────────────────────────────
   No file may restate the rule
   ───────────────────────────────────────────── */

describe('the policy is not duplicated anywhere', () => {
  const files = execSync("find app lib components -name '*.ts' -o -name '*.tsx'",
    { encoding: 'utf8' }).trim().split('\n').filter(Boolean)

  test('no source file declares its own PIN length range', () => {
    const offenders: string[] = []
    for (const file of files) {
      if (file.endsWith('lib/auth/pinPolicy.ts')) continue
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
        // Any \d{n,m} range applied to a PIN, or a hardcoded 4-8 / 4-6 rule.
        if (/\\d\{4,\s*[68]\}/.test(line) || /\\d\{6\}/.test(line) && /pin/i.test(line)) {
          offenders.push(`${file}:${i + 1}  ${trimmed.slice(0, 90)}`)
        }
      })
    }
    assert.deepEqual(offenders, [],
      'these restate the PIN length instead of importing it:\n' + offenders.join('\n'))
  })

  test('account recovery issues a PIN of the policy length', () => {
    const firstRun = readFileSync('app/api/auth/first-run/route.ts', 'utf8')
    assert.match(firstRun, /generatePin\(/,
      'first-run must generate a policy-compliant PIN')
    assert.ok(!/generateOTP\(8\)[\s\S]{0,40}initialPin|initialPin\s*=\s*generateOTP\(8\)/.test(firstRun),
      'first-run still issues an eight-digit PIN, which the four-box form cannot accept')
  })

  /** Source with prose removed — these files explain the rules they follow. */
  const stripped = (path: string) =>
    readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  test('PIN entry is one component, driven by PIN_LENGTH', () => {
    const control = stripped('components/ui/PinFields.tsx')

    // The boxes come from the policy, not from a typed-out number.
    assert.match(control, /length\s*=\s*PIN_LENGTH/,
      'the PIN boxes are not driven by PIN_LENGTH')
    assert.match(control, /Array\.from\(\{ length \}\)/,
      'the boxes are not rendered from the length prop')
    assert.ok(!/MAX_PIN|MIN_PIN/.test(control),
      'the control still carries a variable PIN length')
    assert.ok(!/\{\s*length:\s*[468]\s*\}|maxLength=\{[468]\}/.test(control),
      'a digit count is hardcoded rather than taken from the policy')
  })

  test('nothing hand-rolls a second PIN input', () => {
    /*
     * There were four: sign-in, the emailed code, recovery, and change-PIN.
     * The change-PIN one was declared INSIDE its component, so React remounted
     * it on every keystroke and focus was lost after each digit — the PIN
     * could not be typed straight through. One shared control at module scope
     * is what makes that unrepeatable.
     */
    const offenders: string[] = []

    for (const file of [
      'app/(auth)/login/page.tsx',
      'app/(portal)/admin/settings/change-pin/page.tsx',
    ]) {
      const src = stripped(file)
      // A row of single-character inputs is the shape of a PIN field.
      if (/maxLength=\{1\}/.test(src)) {
        offenders.push(`${file} builds its own single-digit inputs`)
      }
      if (!/PinBoxes/.test(src)) {
        offenders.push(`${file} does not use the shared PinBoxes`)
      }
    }

    assert.deepEqual(offenders, [],
      'PIN entry belongs to components/ui/PinFields:\n  ' + offenders.join('\n  '))
  })

  test('the emailed code uses the same control at its own length', () => {
    const login = stripped('app/(auth)/login/page.tsx')
    assert.match(login, /length=\{OTP_LENGTH\}/,
      'the OTP boxes are not driven by OTP_LENGTH')
  })

  test('sign-in has no on-screen keypad', () => {
    /*
     * A keypad was built here once and removed: it is calculator furniture,
     * and it takes entry away from the hardware keyboards, password managers
     * and one-time-code autofill that the fields get for free. Prose stripped
     * first, because the file explains exactly that.
     */
    const login = stripped('app/(auth)/login/page.tsx') + stripped('components/ui/PinFields.tsx')

    assert.ok(!/keypad|KEYPAD|Keypad/.test(login),
      'the sign-in form has grown an on-screen keypad again')
    // The tell of a keypad: a rendered array of the digits themselves.
    assert.ok(!/\['1',\s*'2',\s*'3'|\[1,\s*2,\s*3,\s*4,\s*5/.test(login),
      'the sign-in form renders digit buttons')
  })
})
