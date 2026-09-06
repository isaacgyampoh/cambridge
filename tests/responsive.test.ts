import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE PAGE NEVER SCROLLS SIDEWAYS.
 *
 * A phone is 320px at its narrowest and 375–390px for most of the people using
 * this system. One element wider than the viewport does not clip — it makes
 * the ENTIRE page scroll horizontally, so every other screen in the product
 * starts drifting under the thumb and headers slide out of view.
 *
 * The two things that cause it here are wide tables and hard pixel widths.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Source with comments blanked out — files discuss <table> and widths in
 * prose, and a naive search finds the prose.
 *
 * Blanked rather than removed, so the line numbers reported below still match
 * the real file. Deleting the lines would point every finding at the wrong
 * place, which is worse than not reporting one.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(l => (l.trim().startsWith('//') ? '' : l))
    .join('\n')
}

const ALL = [...sourceFiles('app'), ...sourceFiles('components')]

describe('nothing forces the page sideways', () => {
  test('every table scrolls inside its own container', () => {
    /*
     * The staff table has eight columns. It sat in a div with
     * `overflow-visible`, so on a tablet the last column pushed the whole
     * page sideways rather than scrolling within the table's own box.
     */
    const offenders: string[] = []

    for (const file of ALL) {
      const src = code(readFileSync(file, 'utf8'))
      if (!/<table\b/.test(src)) continue
      if (!/overflow-x-auto/.test(src)) {
        offenders.push(`${file}: has a <table> and no overflow-x-auto container`)
      }
    }

    assert.deepEqual(offenders, [],
      'a wide table must scroll inside its own box:\n  ' + offenders.join('\n  '))
  })

  test('no unconditional width exceeds the narrowest phone', () => {
    /*
     * 320px is the floor. A fixed width above it is only safe behind a
     * breakpoint (sm:, md:, lg:) or paired with a max-width, because those
     * do not apply on the smallest screens.
     */
    const offenders: string[] = []

    for (const file of ALL) {
      const src = code(readFileSync(file, 'utf8'))

      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/(^|[\s"'`])(w|min-w)-\[(\d+)px\]/g)) {
          const px = Number(m[3])
          if (px <= 320) continue
          // Behind a breakpoint on this same utility? Then it cannot apply
          // at 320px. Look at the characters immediately before the utility.
          const at = m.index ?? 0
          const before = line.slice(Math.max(0, at - 4), at + 1)
          if (/(sm|md|lg|xl):$/.test(before.replace(/[\s"'`]$/, ''))) continue

          // A max-width on the same element caps it regardless — the
          // documented safe pairing for a dialog that wants 400px when there
          // is room and the viewport when there is not.
          if (/max-w-\[/.test(line)) continue

          offenders.push(`${file}:${i + 1} — ${m[2]}-[${px}px]`)
        }
      })
    }

    assert.deepEqual(offenders, [],
      'a width above 320px must sit behind a breakpoint or a max-width:\n  ' +
      offenders.join('\n  '))
  })

  test('the sticky action bar clears the tab bar', () => {
    /*
     * Both are position:fixed against the bottom. Sharing bottom:0 means one
     * covers the other — and the action bar wins on z-index, so the
     * navigation disappears on exactly the screens that have both.
     */
    const css = readFileSync('app/globals.css', 'utf8')

    assert.match(css, /\.action-bar[\s\S]*?bottom:\s*calc\(var\(--tabbar-h\)/,
      'the action bar is not offset above the tab bar')
    assert.match(css, /\.has-actionbar[\s\S]*?padding-bottom:\s*calc\(var\(--tabbar-h\)/,
      'content does not reserve room for both bars')
  })
})

describe('the product speaks with one voice', () => {
  /*
   * Sentence case on every control and heading.
   *
   * The product had both: "Marketer performance" and "Attendance Dashboard",
   * "Add lead" and "Add Another Staff", on screens one tap apart. Title Case
   * is not wrong in itself — mixing the two is, because it reads as two
   * applications stitched together.
   */
  const KEEP = new Set([
    'PIN', 'SMS', 'AI', 'CSV', 'PDF', 'WhatsApp', 'Excel', 'Zoom', 'ID', 'URL',
    'OTP', 'PM', 'Paystack', 'Cambridge', 'Arkesel', 'API', 'QR', 'PMP',
    'Facebook', 'Google', 'LinkedIn', 'Instagram', 'Meta',
  ])

  test('no control label is Title Case', () => {
    const offenders: string[] = []

    for (const file of ALL) {
      const lines = readFileSync(file, 'utf8').split('\n')

      lines.forEach((l, i) => {
        const m = l.match(/^\s+([A-Z][A-Za-z]*(?:\s+[A-Za-z][A-Za-z'’]*)+)\s*$/)
        if (!m) return
        const words = m[1].split(/\s+/)
        if (words.length < 2 || words.length > 4) return

        const capitalised = words.slice(1).filter(w => /^[A-Z]/.test(w) && !KEEP.has(w))
        if (!capitalised.length) return

        const ctx = lines.slice(Math.max(0, i - 6), i).join('\n')
        if (!/<(button|a|Link|Button)\b/.test(ctx)) return

        offenders.push(`${file}:${i + 1} — "${m[1]}"`)
      })
    }

    assert.deepEqual(offenders, [],
      'controls are labelled in sentence case:\n  ' + offenders.join('\n  '))
  })
})

describe('controls are big enough to hit', () => {
  /*
   * 44px is the smallest target a finger reliably hits. The design system's
   * Button is h-12 on a phone for that reason; screens that painted their own
   * buttons had drifted to h-8 and h-9 — 32 and 36px — which is a miss and a
   * retry every time, on the screens people use most.
   *
   * 40px square icon buttons are allowed: they sit in rows with generous
   * spacing around them, and raising them would reflow those rows. Anything
   * SMALLER than that is not.
   */
  const HEIGHTS: Record<string, number> = {
    'h-6': 24, 'h-7': 28, 'h-8': 32, 'h-9': 36, 'h-10': 40, 'h-11': 44, 'h-12': 48,
  }
  const FLOOR = 40

  test('no button or link is smaller than the floor on a phone', () => {
    const offenders: string[] = []

    for (const file of ALL) {
      const src = readFileSync(file, 'utf8')

      for (const m of src.matchAll(/<(button|a)\b((?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g)) {
        const attrs = m[2]
        // A switch carries its hit area on a wrapper; checked separately.
        if (/role="switch"/.test(attrs)) continue

        const cls = attrs.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)
        const className = (cls && (cls[1] || cls[2])) || ''
        if (!className) continue
        if (/min-h-\[4[4-9]px\]|min-h-\[[5-9]\dpx\]/.test(className)) continue

        // The unprefixed height is the one that applies on a phone.
        const bare = [...className.matchAll(/(?:^|\s)(h-\d+)(?=\s|$)/g)].map(x => x[1])
        if (!bare.length) continue

        const px = HEIGHTS[bare[0]]
        if (px === undefined || px >= FLOOR) continue

        const line = src.slice(0, m.index).split('\n').length
        offenders.push(`${file}:${line} — ${bare[0]} (${px}px)`)
      }
    }

    assert.deepEqual(offenders, [],
      `a control must be at least ${FLOOR}px on a phone — use h-11 sm:h-9 to ` +
      `keep the tighter desktop size:\n  ` + offenders.join('\n  '))
  })
})
