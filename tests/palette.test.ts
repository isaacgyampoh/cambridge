import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ONE PALETTE, DECLARED ONCE.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * The product has been through three palettes, and each time the same thing
 * happened: globals.css moved and the places that are NOT a stylesheet did
 * not. At the worst point four were live at once —
 *
 *   globals.css        navy      #16273f
 *   manifest.json      teal      #1a7a85   ← left over from an older design
 *   the admission PDF  teal      #1a7a85
 *   the emails         teal      #1a7a85
 *
 * The manifest one was visible: iOS paints the browser chrome with
 * theme_color, so a teal band sat above the sign-in screen. app/layout.tsx
 * did declare a themeColor, but as `var(--accent)` — a CSS variable, which a
 * meta tag cannot resolve, so it was ignored and the manifest won.
 *
 * The letter is worse than cosmetic: it is the most formal thing the centre
 * sends anybody, and it was arriving in a colour that appeared on nothing
 * else the institution owns.
 *
 * These tests are what stop it happening on the next palette.
 */

const BRAND = '#0B3B2E'      // the dark surface: app bar, tab bar
const ACCENT = '#127A5A'     // the working green
const PAPER = '#FFFFFF'      // surface
const CANVAS = '#F6F8F7'     // page ground

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(l => (l.trim().startsWith('//') ? '' : l))
    .join('\n')
}

describe('the palette is declared once and agreed everywhere', () => {
  test('globals.css defines the brand tokens', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    assert.match(css, new RegExp(`--brand:\\s*${BRAND}`, 'i'),
      '--brand is not the deep forest green')
    assert.match(css, new RegExp(`--accent:\\s*${ACCENT}`, 'i'),
      '--accent is not the working green')
    assert.match(css, new RegExp(`--paper:\\s*${PAPER}`, 'i'),
      '--paper is not the surface white')
    assert.match(css, new RegExp(`--canvas:\\s*${CANVAS}`, 'i'),
      '--canvas is not the page ground')
  })

  test('the token is not named after the colour it holds', () => {
    /*
     * These were --navy-*, and every one had to be renamed the moment the
     * palette moved. A token named for its current value is a rename waiting
     * to happen, and a lie in between.
     */
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const src = code(readFileSync(file, 'utf8'))
      if (/--(navy|teal|blue|green|red)\b/.test(src)) offenders.push(file)
    }
    assert.deepEqual(offenders, [],
      'name a token for its ROLE (--brand, --accent), never its hue:\n  ' +
      offenders.join('\n  '))
  })

  test('the phone chrome matches the application', () => {
    // iOS paints the browser bar with these. They must agree, and neither may
    // be a CSS variable — a meta tag cannot resolve one.
    const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'))
    assert.equal(manifest.theme_color, BRAND,
      'manifest.json theme_color does not match --brand')
    assert.equal(manifest.background_color, CANVAS,
      'manifest.json background_color does not match --canvas')

    const layout = readFileSync('app/layout.tsx', 'utf8')
    assert.match(layout, new RegExp(`themeColor:\\s*'${BRAND}'`, 'i'),
      'the viewport themeColor does not match --brand')
    assert.ok(!/themeColor:\s*'var\(/.test(layout),
      'themeColor is a CSS variable, which a meta tag cannot resolve')
  })

  test('nothing outbound is still the old teal', () => {
    // The admission letter, the emails, the PDF. What the centre sends has to
    // look like the centre.
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('lib')]) {
      const src = code(readFileSync(file, 'utf8'))
      if (/#1a7a85/i.test(src)) offenders.push(file)
      if (/0\.102,\s*0\.478,\s*0\.522/.test(src)) offenders.push(`${file} (as rgb)`)
    }
    assert.deepEqual(offenders, [],
      'the old teal is still being sent to people:\n  ' + offenders.join('\n  '))
  })

  test('screens use tokens, not Tailwind default colours', () => {
    /*
     * A palette change stops working the moment a screen hardcodes a colour:
     * these do not move when globals.css does. That is how the product ended
     * up with four live palettes at once.
     */
    const BANNED = /\b(?:bg|text|border|ring|from|to)-(?:gray|slate|zinc|neutral|stone|blue|indigo|purple|violet|fuchsia|pink|rose|orange|amber|lime|teal|cyan|sky)-\d{2,3}\b/g

    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const src = code(readFileSync(file, 'utf8'))
      for (const m of src.matchAll(BANNED)) {
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(`${file}:${line} — ${m[0]}`)
      }
    }

    assert.deepEqual(offenders, [],
      'use the tokens in globals.css so the palette can actually change:\n  ' +
      offenders.join('\n  '))
  })
})

describe('the sign-in photograph', () => {
  /*
   * The screen is designed around a photograph the institution supplies. It
   * must not become a hard dependency: a login page that renders a broken
   * image, or a grey box, is the worst possible first impression, and a file
   * can always be missing from a deploy.
   */
  test('the page decides on the server whether there is a photograph', () => {
    const page = readFileSync('app/(auth)/login/page.tsx', 'utf8')

    assert.match(page, /existsSync/,
      'the page does not check for the photograph on the server')
    assert.match(page, /heroSrc=\{heroSrc\}/,
      'the resolved photograph is not passed to the form')

    const form = code(readFileSync('app/(auth)/login/LoginForm.tsx', 'utf8'))
    assert.match(form, /\{hasHero &&/,
      'the picture panel renders even when there is no picture')
  })

  test('the photograph may be saved in any common format', () => {
    /*
     * The picture is exported by whoever took it: a phone gives a .jpg, a
     * design tool a .png, a modern export a .webp. Accepting one extension
     * would mean a correctly-supplied photograph silently not appearing.
     */
    const page = readFileSync('app/(auth)/login/page.tsx', 'utf8')

    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      assert.match(page, new RegExp(`brand/login-hero\\.${ext}`),
        `a photograph saved as .${ext} would not be found`)
    }

    // The form renders whatever the server resolved, never a path of its own.
    const form = readFileSync('app/(auth)/login/LoginForm.tsx', 'utf8')
    assert.ok(!/['"]\/brand\/login-hero/.test(form),
      'the form hardcodes a photograph path instead of using the resolved one')
  })
})
