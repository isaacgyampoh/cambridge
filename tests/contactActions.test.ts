import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  canonicalContact, telHref, whatsappHref, whatsappShareHref, displayPhone,
} from '../lib/ui/contact.ts'

/**
 * THE WHATSAPP AND CALL BUTTONS ON A PHONE.
 *
 * ── WHAT STAFF REPORTED ────────────────────────────────────────────────────
 *
 * On some Android phones the buttons worked; on others tapping WhatsApp did
 * nothing, or landed in an SMS/MMS composer, and Call did nothing at all.
 * Same build, different devices.
 *
 * ── WHAT IT WAS ────────────────────────────────────────────────────────────
 *
 * Nothing in the application ever emitted an sms:, smsto:, mms: or mmsto:
 * URI — that is asserted below and it was true before the fix too. The MMS
 * composer came from Android's own chooser, which is what answers a WhatsApp
 * SHARE link (wa.me with no number in the path). Messages accepts shared
 * text, so it appears in the list.
 *
 * Call failed for a different reason: the button awaited a network request
 * before setting window.location, and a browser only hands a tel: URL to the
 * dialler while the user activation from the tap is still live.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Every .tsx under app/ and components/, with comments stripped. */
function allScreens(): Array<{ path: string; src: string }> {
  const out: Array<{ path: string; src: string }> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push({ path: p, src: codeOf(p) })
    }
  }
  walk('app'); walk('components'); walk('lib')
  return out
}

const screens = allScreens()
const contact = codeOf('lib/ui/contact.ts')
const callButton = codeOf('components/shared/CallButton.tsx')
const action = codeOf('components/shared/ContactAction.tsx')
const sw = readFileSync('public/sw.js', 'utf8')

/* ══ PHONE NORMALISATION ══════════════════════════════════════════════════ */

describe('Ghana numbers reach the right destination', () => {
  const expected = '233241234567'

  for (const input of [
    '0241234567', '+233241234567', '233241234567',
    '00233241234567', '+233 24 123 4567', '024 123 4567', '024-123-4567',
  ]) {
    test(`${input} normalises`, () => {
      assert.equal(canonicalContact(input), expected)
    })
  }

  test('other Ghana prefixes work too', () => {
    assert.equal(canonicalContact('0201234567'), '233201234567')
    assert.equal(canonicalContact('0541234567'), '233541234567')
  })

  test('the country code is never duplicated', () => {
    for (const input of ['00233241234567', '+233241234567', '233241234567']) {
      const out = canonicalContact(input)
      assert.ok(out && !out.startsWith('233233'), `${input} -> ${out}`)
      assert.ok(out && !/^2330/.test(out), `${input} produced a 2330… number: ${out}`)
    }
  })

  test('a number that is not a Ghanaian mobile yields no link at all', () => {
    // Better no button than a tel: that fails silently when tapped.
    for (const bad of ['', '12345', '+44 7700 900000', 'not a phone', null, undefined]) {
      assert.equal(canonicalContact(bad as string), null, String(bad))
      assert.equal(telHref(bad as string), null)
      assert.equal(whatsappHref(bad as string), null)
    }
  })

  test('the number is shown to a Ghanaian reader in local form', () => {
    assert.equal(displayPhone('+233241234567'), '0241234567')
  })
})

/* ══ LINK FORMAT ══════════════════════════════════════════════════════════ */

describe('the call link is a dialler link', () => {
  test('tel: with a full international number', () => {
    assert.equal(telHref('0241234567'), 'tel:+233241234567')
  })

  test('it never contains a space, which Android diallers reject', () => {
    assert.ok(!/\s/.test(telHref('+233 24 123 4567') as string))
  })

  test('it is never sms:, whatsapp: or mms:', () => {
    const href = telHref('0241234567') as string
    assert.ok(href.startsWith('tel:'))
    assert.ok(!/^(sms|smsto|mms|mmsto|whatsapp):/.test(href))
  })
})

describe('the WhatsApp link addresses a person', () => {
  test('it is an https wa.me URL, not a custom scheme', () => {
    const href = whatsappHref('0241234567') as string
    assert.ok(href.startsWith('https://wa.me/'),
      'an https URL is what Android matches against WhatsApp’s App Links filter')
    assert.ok(!href.startsWith('whatsapp://'))
  })

  test('the number is in the PATH, so it opens a conversation', () => {
    assert.equal(whatsappHref('0241234567'), 'https://wa.me/233241234567')
  })

  test('it is NEVER the numberless share form', () => {
    /*
     * This is the MMS bug. wa.me with no number is a share intent, and
     * Android answers a share intent with its chooser, which lists Messages.
     */
    const href = whatsappHref('0241234567', 'hello') as string
    assert.ok(!href.startsWith('https://wa.me/?'),
      'a person-directed WhatsApp link must carry the number in the path')
  })

  test('and never an SMS or MMS URI', () => {
    const href = whatsappHref('0241234567', 'hello') as string
    assert.ok(!/^(sms|smsto|mms|mmsto):/.test(href))
    assert.ok(!/[?&](sms|mms)=/.test(href))
  })
})

/* ══ MESSAGE ENCODING ═════════════════════════════════════════════════════ */

describe('a prefilled message survives the URL', () => {
  const cases: Array<[string, string]> = [
    ['Hello, I am interested in PMP.', 'Hello, I am interested in PMP.'],
    ['I want to know the price & next class.', 'I want to know the price & next class.'],
    ['PMP + registration', 'PMP + registration'],
    ['50% off? #PMP', '50% off? #PMP'],
    ['line one\nline two', 'line one\nline two'],
    ["it's 100% confirmed", "it's 100% confirmed"],
    ['a=b&c=d', 'a=b&c=d'],
  ]

  for (const [message] of cases) {
    test(`round-trips: ${JSON.stringify(message)}`, () => {
      const href = whatsappHref('0241234567', message) as string
      const text = new URL(href).searchParams.get('text')
      assert.equal(text, message)
    })
  }

  test('a "+" is encoded, so it does not arrive as a space', () => {
    const href = whatsappHref('0241234567', 'PMP + registration') as string
    assert.ok(href.includes('%2B'), href)
  })

  test('an "&" cannot start a second parameter', () => {
    const href = whatsappHref('0241234567', 'price & date') as string
    assert.equal(new URL(href).searchParams.get('text'), 'price & date')
    assert.equal([...new URL(href).searchParams.keys()].length, 1)
  })

  test('a "#" cannot truncate the message', () => {
    const href = whatsappHref('0241234567', 'about #PMP') as string
    assert.equal(new URL(href).hash, '')
  })

  test('the share form encodes identically', () => {
    const href = whatsappShareHref('PMP + price & date')
    assert.equal(new URL(href).searchParams.get('text'), 'PMP + price & date')
  })

  test('nothing is assembled by hand', () => {
    assert.match(contact, /new URLSearchParams\(\{ text: message \}\)/)
    assert.match(contact, /new URLSearchParams\(\{ text \}\)/)
  })
})

/* ══ NO SMS ANYWHERE ══════════════════════════════════════════════════════ */

describe('a WhatsApp button can never become SMS or MMS', () => {
  test('the application emits no sms:, smsto:, mms: or mmsto: URI at all', () => {
    const offenders: string[] = []
    for (const { path, src } of screens) {
      // A URI, not an identifier: the scheme must be followed by a value and
      // preceded by a quote, backtick or '=' — so `sms: Send` in an icon map
      // and a `sms:` property key do not count.
      if (/["'`]\s*(sms|smsto|mms|mmsto):[^/\s]/i.test(src)) offenders.push(path)
    }
    assert.deepEqual(offenders, [],
      `these files build an SMS/MMS URI: ${offenders.join(', ')}`)
  })

  test('no component converts a WhatsApp action into anything else', () => {
    for (const { path, src } of screens) {
      if (!/whatsapp/i.test(src)) continue
      /*
       * A URI, not an identifier. `sms: boolean` in a result type and
       * `sms: Send` in an icon map are not SMS links, and an outbound server
       * route that tries WhatsApp and falls back to the SMS PROVIDER is a
       * delivery channel, not a button — neither is what this is looking for.
       */
      assert.ok(!/href=[^>]{0,80}(sms|smsto|mms|mmsto):/i.test(src),
        `${path} may route a WhatsApp action to SMS`)
    }
  })
})

/* ══ THE RENDERED CONTROL ═════════════════════════════════════════════════ */

describe('the button is an anchor the browser can act on', () => {
  test('Call navigates via href, not via a handler after an await', () => {
    /*
     * THE root cause. A navigation set after `await fetch(...)` has spent the
     * user activation from the tap, and the browser silently declines to hand
     * tel: to the dialler. Whether it worked came down to how fast the
     * network answered.
     */
    assert.ok(!/window\.location\.href\s*=\s*[`'"]tel:/.test(callButton),
      'Call must not navigate from JavaScript')
    assert.match(callButton, /<a href=\{href\} onClick=\{log\}/)
    assert.match(callButton, /const href = telHref\(phone\)/)
  })

  test('the log cannot delay or block the call', () => {
    assert.match(callButton, /keepalive: true/)
    const log = callButton.slice(callButton.indexOf('function log()'))
    assert.ok(!/await /.test(log.slice(0, 500)),
      'awaiting before navigation is what broke this')
    assert.ok(!/preventDefault/.test(callButton))
  })

  test('the Call button is never disabled while it works', () => {
    assert.ok(!/disabled=\{busy\}|disabled=\{loading\}/.test(callButton))
  })

  test('the shared actions are anchors with real hrefs', () => {
    assert.match(action, /<a\s+href=\{href\}/)
    assert.ok(!/onClick=\{[^}]*location\.href/.test(action))
    assert.ok(!/window\.open/.test(action))
  })

  test('WhatsApp does not ask for a new browsing context', () => {
    // target="_blank" means "new context first, hand-off second" — two hops,
    // and inside a PWA the first is a Custom Tab.
    assert.ok(!/target="_blank"/.test(action))
    for (const { path, src } of screens) {
      /*
       * Every anchor tag, then filtered on the href — NOT only tags that
       * mention whatsappHref inline. Most screens compute the URL into a
       * variable first (`href={wa}`), and an earlier version of this test
       * matched only the inline form and so passed while six screens still
       * opened WhatsApp in a new tab.
       */
      for (const tag of src.match(/<a\b[^>]*>/g) || []) {
        if (!/href=\{(wa|whatsappHref|waHref|shareHref)\b|wa\.me/.test(tag)) continue
        assert.ok(!/target="_blank"/.test(tag),
          `${path} opens WhatsApp in a new tab: ${tag.slice(0, 80)}`)
      }
    }
  })

  test('no window.open is used for a WhatsApp or tel action', () => {
    for (const { path, src } of screens) {
      if (!/window\.open/.test(src)) continue
      assert.ok(!/window\.open\([^)]*(wa\.me|whatsappHref|tel:)/.test(src),
        `${path} opens a contact action through window.open, which mobile pop-up blocking refuses`)
    }
  })

  test('opener is never handed to wa.me', () => {
    assert.match(action, /rel="noopener noreferrer"/)
  })

  test('no anchor is nested inside another anchor or a button', () => {
    for (const { path, src } of screens) {
      assert.ok(!/<button[^>]*>(?:(?!<\/button>)[\s\S]){0,300}?<a\s/.test(src),
        `${path} nests an anchor inside a button`)
      /*
       * Two anchors in a row are siblings, not nesting. Only an opening <a
       * with no </a> before the next one is a real nested anchor.
       */
      assert.ok(!/<a\s[^>]*>(?:(?!<\/a>)[\s\S]){0,300}?<a\s/.test(src),
        `${path} nests an anchor inside an anchor`)
    }
  })

  test('the touch target clears the 44px floor', () => {
    assert.match(action, /min-h-\[44px\]/)
    assert.match(callButton, /min-h-\[44px\]/)
  })

  test('the pair wraps rather than shrinking on a narrow card', () => {
    assert.match(action, /flex flex-wrap gap-2/)
    assert.match(action, /min-w-\[140px\]/)
  })
})

/* ══ FALLBACK ═════════════════════════════════════════════════════════════ */

describe('an unusable number degrades honestly', () => {
  test('there is no link, and the number is offered to copy', () => {
    assert.match(action, /function CopyFallback/)
    assert.match(action, /navigator\.clipboard\.writeText/)
    assert.match(action, /if \(!href\) return <CopyFallback/)
  })

  test('Call does the same rather than rendering a dead link', () => {
    assert.match(callButton, /if \(!href\) \{/)
    assert.match(callButton, /displayPhone\(phone\)/)
  })

  test('nothing claims the action succeeded', () => {
    for (const src of [action, callButton]) {
      assert.ok(!/WhatsApp opened|Opening WhatsApp|Call started|Dialling/i.test(src),
        'the application cannot know whether the device handled the hand-off')
    }
  })
})

/* ══ PWA ══════════════════════════════════════════════════════════════════ */

describe('the PWA does not stand in the way', () => {
  test('the service worker ignores every other origin', () => {
    // wa.me never reaches the worker, so it cannot be rewritten or cached.
    assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return/)
  })

  test('and it only ever handles GET', () => {
    assert.match(sw, /if \(request\.method !== 'GET'\) return/)
  })

  test('nothing rewrites an external contact URL through the app', () => {
    for (const { path, src } of screens) {
      assert.ok(!/router\.(push|replace)\([`'"]https:\/\/wa\.me/.test(src),
        `${path} sends a WhatsApp URL through the Next.js router`)
      assert.ok(!/router\.(push|replace)\([`'"]tel:/.test(src),
        `${path} sends a tel: URL through the Next.js router`)
    }
  })

  test('there is no internal forwarding page', () => {
    for (const { path } of screens) {
      assert.ok(!/app\/whatsapp\/page\.tsx$|app\/call\/page\.tsx$/.test(path),
        `${path} forwards an external action through the application`)
    }
  })

  test('the CSP does not restrict outbound navigation', () => {
    const proxy = codeOf('proxy.ts')
    assert.ok(!/navigate-to/.test(proxy),
      'a navigate-to directive would block the hand-off to WhatsApp or the dialler')
  })
})

/* ══ ONE IMPLEMENTATION ═══════════════════════════════════════════════════ */

describe('there is one implementation of each link', () => {
  test('no screen assembles a wa.me URL by hand', () => {
    for (const { path, src } of screens) {
      if (path.endsWith('lib/ui/contact.ts')) continue
      assert.ok(!/["'`]https:\/\/wa\.me\//.test(src),
        `${path} builds a WhatsApp URL itself instead of using lib/ui/contact`)
    }
  })

  test('nor a tel: URL', () => {
    for (const { path, src } of screens) {
      if (path.endsWith('lib/ui/contact.ts')) continue
      assert.ok(!/[`'"]tel:\$\{/.test(src),
        `${path} interpolates a raw number into a tel: URL`)
    }
  })

  test('the share form is a separate, deliberately named function', () => {
    assert.match(contact, /export function whatsappShareHref\(text: string\): string/)
    assert.match(contact, /export function whatsappHref\(/)
  })

  test('no file shadows the canonical name with a local one', () => {
    for (const { path, src } of screens) {
      if (path.endsWith('lib/ui/contact.ts')) continue
      assert.ok(!/function whatsappHref\(/.test(src),
        `${path} defines its own whatsappHref, shadowing the canonical import`)
    }
  })
})
