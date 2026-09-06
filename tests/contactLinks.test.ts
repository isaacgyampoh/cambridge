import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalContact, whatsappHref, telHref } from '../lib/ui/contact.ts'

/**
 * PHONE NUMBERS ARE NORMALISED IN ONE PLACE.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * Four screens built their own WhatsApp links, each with a different and
 * individually-wrong idea of how to turn a stored number into a wa.me URL:
 *
 *   marketer/leads/[id]  .replace(/^0/,'233').replace(/^\+/,'')
 *   pm/leads/[id]        .replace(/^0/,'233')                  — kept the '+'
 *   marketer/activities  .replace(/^0/,'233')                  — kept the '+'
 *   admission/process    .replace(/^0/,'233').replace(/[^0-9]/,'')
 *
 * None of them removed SPACES, so every number stored as "+233 24 123 4567" —
 * which is how a person types one — produced a URL containing spaces that
 * opens to nothing. The last is the clearest: the character class has no /g
 * flag, so it stripped exactly one non-digit and left the rest.
 *
 * These fail silently. WhatsApp opens, shows no conversation, and the member
 * of staff assumes the lead is unreachable rather than that the link is
 * broken. Nothing is logged, because from the application's point of view a
 * link was clicked and that is all it knows.
 *
 * canonicalContact is the single implementation and it is exercised below.
 * The source check then holds the line: a screen that hand-rolls the
 * conversion again fails this test rather than shipping.
 */

describe('a phone number is turned into a link in exactly one way', () => {
  /* ── the shapes real records actually hold ───────────────────────────── */

  const SAME_NUMBER = [
    '0244123456',
    '+233244123456',
    '233244123456',
    '+233 24 412 3456',
    '024 412 3456',
    '+233-24-412-3456',
    ' 0244123456 ',
  ]

  test('every way of writing one number canonicalises to the same digits', () => {
    const canonical = SAME_NUMBER.map(canonicalContact)
    for (const [i, got] of canonical.entries()) {
      assert.equal(got, '233244123456',
        `"${SAME_NUMBER[i]}" did not canonicalise to the Ghanaian international form`)
    }
  })

  test('a wa.me link never contains a space or a plus', () => {
    for (const raw of SAME_NUMBER) {
      const href = whatsappHref(raw)
      assert.ok(href, `no link produced for "${raw}"`)
      assert.ok(!/[ +]/.test(href.replace(/\?text=.*$/, '')),
        `the link for "${raw}" carries a character WhatsApp will not resolve: ${href}`)
      assert.match(href, /^https:\/\/wa\.me\/233244123456/)
    }
  })

  test('a message is encoded rather than pasted into the URL', () => {
    const href = whatsappHref('0244123456', 'Hello Ama & Kofi, your fee is 50% paid')
    assert.ok(href)
    assert.ok(!/ /.test(href), 'the message was not URL-encoded')
    assert.match(href, /%26/, 'an ampersand would otherwise start a new query parameter')
  })

  test('a number that is not a Ghanaian mobile yields no link at all', () => {
    // A dead control is worse than an absent one: it looks like it will work.
    for (const bad of ['', '   ', 'not a number', '12345', null, undefined]) {
      assert.equal(whatsappHref(bad), null, `"${bad}" produced a link`)
      assert.equal(telHref(bad), null, `"${bad}" produced a tel: link`)
    }
  })

  /* ── nobody builds one by hand again ─────────────────────────────────── */

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) sourceFiles(full, out)
      else if (/\.tsx?$/.test(full)) out.push(full)
    }
    return out
  }

  /** Source with comments removed — the files EXPLAIN this rule in prose. */
  function code(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
  }

  test('no screen builds a contact link from a phone number itself', () => {
    /*
     * Scoped to LINK BUILDING, which is the failure that was actually
     * observed and fixed.
     *
     * Fifteen further files convert 0 -> 233 for their own purposes — the SMS
     * transport, duplicate detection, the WhatsApp webhook. Those are server
     * side, they do not build a URL, and normaliseRecipient already owns the
     * transport case. Sweeping them into this rule would assert something
     * that has not been verified, so they are deliberately out of scope here.
     */
    const offenders: string[] = []

    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const src = code(readFileSync(file, 'utf8'))

      for (const line of src.split('\n')) {
        // `wa.me/?text=` carries no number and is a share sheet — allowed.
        // `wa.me/${...}` is a number being pasted into a URL.
        if (/wa\.me\/\$\{/.test(line)) {
          offenders.push(`${file}: builds a wa.me link from an expression`)
        }
        if (/href=\{`tel:\$\{/.test(line) && !/telHref/.test(line)) {
          offenders.push(`${file}: builds a tel: link from an expression`)
        }
      }
    }

    assert.deepEqual(offenders, [],
      'contact links must come from lib/ui/contact, which strips spaces and a ' +
      'leading + :\n  ' + offenders.join('\n  '))
  })

  test('a non-global character class is never used to strip punctuation', () => {
    /*
     * .replace(/[^0-9]/, '') removes ONE character. It reads as "keep only
     * digits" and does nothing of the sort, which is why the admission screen
     * produced "23324 123 4567".
     */
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]) {
      const src = code(readFileSync(file, 'utf8'))
      if (/replace\(\/\[\^0-9\]\/\s*,/.test(src) || /replace\(\/\\D\/\s*,/.test(src)) {
        offenders.push(file)
      }
    }
    assert.deepEqual(offenders, [],
      'these strip a single character, not all of them — the /g flag is missing:\n  ' +
      offenders.join('\n  '))
  })
})
