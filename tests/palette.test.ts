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

/*
 * Lifted from #0B3B2E / #127A5A, which were near-black.
 *
 * --brand sat at L* 21.6 and 12.5:1 against white — four times the contrast
 * white text on it needs, spent entirely on darkness. It read as black with a
 * green cast rather than as green, and it was the PWA theme colour, so it was
 * the first thing anybody saw.
 *
 * --accent moved least, and the test below says why: it carries white text,
 * so 4.5:1 is a floor rather than a preference.
 */
const BRAND = '#15664D'      // the dark surface: app bar, tab bar
const ACCENT = '#1A7F61'     // the working green
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


/**
 * ─── THE ACCENT CARRIES WHITE TEXT ──────────────────────────────────────────
 *
 * Which makes 4.5:1 a floor, not a preference — every primary button in the
 * product is white on this colour.
 *
 * The values were pinned here before without ever being measured, so "too
 * dark" and "too light" were both a rename away and neither would have failed
 * anything. These assert the property the hex is chosen FOR, so the next
 * person to move the green finds out immediately if they have moved it past
 * what the label on a button can survive.
 */
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [0, 2, 4].map(i => channel(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

/** CIE L*, the perceptual lightness. Used only to assert direction. */
function lightness(hex: string): number {
  const y = relativeLuminance(hex)
  return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y
}

describe('the greens are legible and in the right order', () => {
  const css = readFileSync('app/globals.css', 'utf8')
  const tokenValue = (name: string): string => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))
    assert.ok(m, `--${name} is not defined as a hex value`)
    return m![1]
  }

  test('white text on the accent passes AA', () => {
    const ratio = contrast(tokenValue('accent'), '#FFFFFF')
    assert.ok(ratio >= 4.5,
      `white on --accent is ${ratio.toFixed(2)}:1 — below the 4.5:1 AA floor for body text. `
      + 'Every primary button in the product is white on this colour.')
  })

  test('and so does white on the brand', () => {
    const ratio = contrast(tokenValue('brand'), '#FFFFFF')
    assert.ok(ratio >= 4.5, `white on --brand is ${ratio.toFixed(2)}:1`)
  })

  test('the accent is still readable against the page ground', () => {
    // It is used for links and icons on --canvas, not only as a fill.
    const ratio = contrast(tokenValue('accent'), CANVAS)
    assert.ok(ratio >= 3, `--accent on --canvas is ${ratio.toFixed(2)}:1 — below the 3:1 UI floor.`)
  })

  test('hover deepens rather than lightens', () => {
    assert.ok(lightness(tokenValue('accent-hover')) < lightness(tokenValue('accent')),
      'a hover state that gets lighter reads as disabled')
  })

  test('pressed is deeper than the brand', () => {
    assert.ok(lightness(tokenValue('brand-deep')) < lightness(tokenValue('brand')))
  })

  test('the greens are no longer near-black', () => {
    /*
     * The complaint that prompted this. Below about L* 30 a saturated green
     * stops reading as green at all and becomes a very dark neutral.
     */
    assert.ok(lightness(tokenValue('brand')) > 30,
      `--brand is L* ${lightness(tokenValue('brand')).toFixed(1)} — dark enough to read as black.`)
    assert.ok(lightness(tokenValue('accent')) > 40,
      `--accent is L* ${lightness(tokenValue('accent')).toFixed(1)}`)
  })

  test('no screen keeps a copy of the pre-lift greens', () => {
    // They were in four places outside globals.css and would have stayed dark.
    const stale = ['#0B3B2E', '#127A5A', '#072A21', '#0E6249']
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const src = readFileSync(file, 'utf8')
      for (const hex of stale) {
        if (src.includes(hex)) offenders.push(`${file} — ${hex}`)
      }
    }
    assert.deepEqual(offenders.map(o => o.replace(/^.*?cambridge\//, '')), [],
      'a pre-lift green is hardcoded somewhere and will not have moved')
  })
})


/**
 * ─── BRIGHT FILLS CARRY DARK TEXT ───────────────────────────────────────────
 *
 * --accent is dark because it carries WHITE text, and that caps how bright it
 * can ever be: white on it needs 4.5:1. Inverting the relationship removes the
 * cap — dark ink on a bright fill clears AA by a mile, so the colour can be as
 * alive as it likes.
 *
 * That is the whole reason these exist, and it is conditional on the pairing.
 * White on --accent-bright is about 1.4:1 and illegible. A future edit that
 * puts a white label on one of these produces a button nobody can read, so the
 * tests below assert the pairing rather than the hex.
 */
describe('the bright fills are surfaces, not buttons', () => {
  const css = readFileSync('app/globals.css', 'utf8')
  const tokenValue = (name: string): string => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))
    assert.ok(m, `--${name} is not defined as a hex value`)
    return m![1]
  }
  const INK = '#10231C'

  test('dark ink on them passes AA comfortably', () => {
    for (const token of ['accent-bright', 'attention']) {
      const r = contrast(tokenValue(token), INK)
      assert.ok(r >= 4.5,
        `--ink on --${token} is ${r.toFixed(2)}:1 — below the 4.5:1 AA floor.`)
    }
  })

  test('and white on them does NOT — which is the point', () => {
    /*
     * Asserted deliberately. If one of these ever became light enough to
     * carry white text it would no longer be a bright fill, and the reason
     * the pairing is mandatory would have quietly disappeared.
     */
    for (const token of ['accent-bright', 'attention']) {
      const r = contrast(tokenValue(token), '#FFFFFF')
      assert.ok(r < 4.5,
        `white on --${token} is ${r.toFixed(2)}:1 — bright enough that the `
        + 'dark-text rule would no longer be obvious to the next person.')
    }
  })

  test('they are genuinely brighter than the accent', () => {
    // Otherwise they add a third green and solve nothing.
    assert.ok(lightness(tokenValue('accent-bright')) > lightness(tokenValue('accent')) + 25)
  })

  test('no screen puts white text on one', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const src = readFileSync(file, 'utf8')
      // A fill and a white text colour within the same element's classes.
      for (const m of src.matchAll(/class(?:Name)?="([^"]*)"/g)) {
        const cls = m[1]
        if (!/accent-bright|--attention\)/.test(cls)) continue
        if (/text-white|text-\[#fff/i.test(cls)) {
          offenders.push(`${file.replace(/^.*?cambridge\//, '')} — ${cls.slice(0, 60)}`)
        }
      }
    }
    assert.deepEqual(offenders, [],
      'white text on a bright fill is around 1.4:1 and cannot be read')
  })

  test('the attention colour is not used for errors', () => {
    /*
     * --danger means something went wrong. --attention means somebody has to
     * act. Collapsing them makes a queue that needs a look indistinguishable
     * from a failure, and people stop believing either.
     */
    assert.notEqual(tokenValue('attention'), tokenValue('danger'))
  })
})

describe('the figures that matter are given weight', () => {
  test('the student portal leads with the balance, coloured by whether it is owed', () => {
    /*
     * It was a thin green banner with a first name over three identical white
     * icon cards. Nothing said which number mattered, so a student owing money
     * and one owing nothing saw the same page.
     */
    const page = readFileSync('app/(portal)/student/page.tsx', 'utf8')
    assert.match(page, /owes \? 'var\(--attention\)' : 'var\(--accent-bright\)'/)
    assert.match(page, /owes \? formatGHS\(totalOwed\) : 'Nothing due'/)
  })

  test('and the staff dashboard states its one fact as a block', () => {
    const src = readFileSync('components/dashboard/Overview.tsx', 'utf8')
    assert.match(src, /needsMe \? 'var\(--attention\)' : 'var\(--accent-bright\)'/)
    // The same sentence as before — promoted, not rewritten.
    assert.match(src, /\{summary\}/)
  })

  test('the lists below stay white, so the colour still means something', () => {
    const src = readFileSync('components/dashboard/Overview.tsx', 'utf8')
    const fills = (src.match(/var\(--accent-bright\)|var\(--attention\)/g) || []).length
    assert.ok(fills <= 2,
      `${fills} bright fills on one screen — the moment everything is coloured, nothing is.`)
  })
})

/**
 * ─── THE TOKENS ACTUALLY GOVERN THE SCREENS ─────────────────────────────────
 *
 * There was a design system in globals.css that the screens did not use.
 * --radius-surface appeared in three places; six hundred and twenty-six
 * hardcoded `rounded-xl` / `rounded-2xl` classes went round it — so lifting
 * the token from 16px to 20px changed the two screens edited by hand and
 * nothing else.
 *
 * The convention was real. It just was not wired, so the token could not move
 * the thing it described.
 */
describe('the radius utilities resolve to the tokens', () => {
  const css = readFileSync('app/globals.css', 'utf8')

  test('Tailwind’s scale is mapped onto the design tokens', () => {
    assert.match(css, /@theme inline \{[\s\S]*?--radius-xl:\s*var\(--radius-control\)/)
    assert.match(css, /@theme inline \{[\s\S]*?--radius-2xl:\s*var\(--radius-surface\)/)
  })

  test('so a change to a token reaches every surface', () => {
    /*
     * The property this exists for. If somebody replaces the var() with a
     * literal, the mapping still compiles and the token silently stops
     * governing anything again.
     */
    const theme = css.slice(css.indexOf('@theme inline'), css.indexOf('}', css.indexOf('@theme inline')))
    assert.ok(!/--radius-2xl:\s*\d/.test(theme),
      'a literal here disconnects the token from the utility')
  })

  test('rounded-lg is deliberately left alone', () => {
    // Small things — icon tiles, chips inside a row — where the control
    // radius is too round.
    const theme = css.slice(css.indexOf('@theme inline'), css.indexOf('}', css.indexOf('@theme inline')))
    assert.ok(!/--radius-lg/.test(theme))
  })
})

describe('a row that needs work is visible without reading it', () => {
  const table = readFileSync('components/ui/DataTable.tsx', 'utf8')

  test('the shared table can mark one', () => {
    /*
     * A table where one row has failed and forty have not looks, at a glance,
     * exactly like a table where none has. The difference was a word in a
     * column somebody had to read across to reach.
     */
    assert.match(table, /needsAttention\?: \(row: T\) => boolean/)
  })

  test('both the phone card and the table row carry it', () => {
    // 18 screens use this component, and most of them are used on a phone.
    assert.match(table, /flagged[\s\S]{0,200}attention-soft/)
    assert.match(table, /needsAttention\?\.\(row\) \? 'bg-\[var\(--attention-soft\)\]' : ''/)
  })

  test('a tinted row is not then hovered back to the plain canvas', () => {
    // That would wash the signal out exactly when somebody reaches for it.
    assert.match(table, /flagged \? '' : 'hover:bg-\[var\(--canvas\)\]'/)
  })

  test('it is a tint, not the danger colour', () => {
    /*
     * A queue that needs a look is not a failure. A table that cries error at
     * routine work teaches people to ignore the colour.
     */
    assert.ok(!/attention[\s\S]{0,80}--danger/.test(table))
  })

  test('and it is used where somebody actually has to act', () => {
    const cases: Array<[string, RegExp]> = [
      // A lead nobody is working.
      ['app/(portal)/pm/assign/page.tsx', /needsAttention=\{l => !l\.assigned_to\}/],
      // Money still owed by a student.
      ['app/(portal)/finance/student-fees/page.tsx', /needsAttention=\{f => Number\(f\.balance\) > 0\}/],
      // Commission still owed TO a marketer — the whole point of that screen.
      ['app/(portal)/finance/registrations/page.tsx', /needsAttention=\{r => !r\.commissionPaid\}/],
      // A graduate who has not been given their certificate.
      ['app/(portal)/admin/certificates/page.tsx', /needsAttention=\{c => !c\.issued\}/],
      // A student flagged as needing support.
      ['app/(portal)/coordinator/page.tsx', /needsAttention=\{r => r\.prep_status === 'needs_support'\}/],
      // School fees outstanding on a class list.
      ['app/(portal)/admin/classes/[id]/students/page.tsx', /needsAttention=\{e => !e\.fees_paid\}/],
    ]
    for (const [file, pattern] of cases) {
      assert.match(readFileSync(file, 'utf8'), pattern, `${file} lost its row marking`)
    }
  })

  test('and NOT on the screens where it would be noise', () => {
    /*
     * A tint means "somebody must act on this row". On a performance table it
     * would mean "this person is underperforming", which is a judgement
     * rendered in colour on every row that is merely below average — and a
     * colour that appears everywhere stops being read anywhere.
     *
     * Reports, logs and analytics have no row to act on at all.
     */
    for (const file of [
      'app/(portal)/pm/page.tsx',
      'app/(portal)/pm/reports/page.tsx',
      'app/(portal)/admin/remuneration/page.tsx',
      'app/(portal)/admin/conversions/page.tsx',
      'app/(portal)/admin/referrals/page.tsx',
    ]) {
      assert.ok(!readFileSync(file, 'utf8').includes('needsAttention'),
        `${file} is a report or a ranking, not a queue`)
    }
  })
})

/**
 * ─── THE TAB BAR ────────────────────────────────────────────────────────────
 *
 * It was an edge-to-edge band of --brand with white labels at 45% opacity —
 * which is where a tab bar goes on a phone and also where it disappears. A
 * dark strip welded to the bottom reads as chrome, and the destination a
 * person was actually on was distinguished only by being less faded than its
 * neighbours.
 */
describe('the tab bar marks where you are with a shape', () => {
  const layout = readFileSync('components/shared/PortalLayout.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')

  test('it floats rather than welding to the edge', () => {
    const bar = css.slice(css.indexOf('.tab-bar {'), css.indexOf('.has-tabbar'))
    assert.match(bar, /padding-bottom: calc\(env\(safe-area-inset-bottom\) \+ 10px\)/)
    assert.match(bar, /border-radius: var\(--radius-full\)/)
  })

  test('the gap either side is not a tap target', () => {
    // A floating bar leaves live screen on both sides of it.
    const bar = css.slice(css.indexOf('.tab-bar {'), css.indexOf('.has-tabbar'))
    assert.match(bar, /pointer-events: none/)
    assert.match(bar, /pointer-events: auto/)
  })

  test('content still clears it', () => {
    // The bar got taller when it lifted off the edge; --tabbar-h carries that
    // so no screen has to remember.
    assert.match(css, /--tabbar-h: 76px/)
    assert.match(css, /\.has-tabbar \{[\s\S]{0,140}var\(--tabbar-h\)/)
  })

  test('the active tab is filled, not merely less faded', () => {
    assert.match(layout, /active\s*\n?\s*\? 'flex-row[^']*bg-\[var\(--ink\)\][^']*'/)
    assert.ok(!/text-white\/45/.test(layout),
      'opacity is not a state anybody can name')
  })

  test('every tab keeps its label', () => {
    /*
     * Hiding the inactive ones leaves four bare icons, and an icon is only
     * obvious to somebody who already knows what it does — which is not the
     * person who needs the nav.
     */
    const nav = layout.slice(layout.indexOf('aria-label="Main"'))
    assert.ok(!/sr-only/.test(nav.slice(0, 2200)),
      'a visually hidden label means an icon-only tab')
    assert.match(nav, /\{tab\.label\}/)
    // The size is asserted by the scale-floor test below, not pinned here —
    // pinning it is how this test kept passing while the label shrank to 10px.
    assert.match(nav, /font-medium/)
  })

  test('More keeps its label too', () => {
    const nav = layout.slice(layout.indexOf('aria-label="Main"'))
    assert.match(nav, /font-medium leading-none">More<\/span>/)
  })

  test('every target clears the 44px minimum', () => {
    const nav = layout.slice(layout.indexOf('aria-label="Main"'))
    const targets = nav.match(/min-h-\[(\d+)px\]/g) || []
    assert.ok(targets.length >= 2, 'the tabs and More must both set a minimum')
    for (const t of targets) {
      assert.ok(Number(t.match(/\d+/)![0]) >= 44, `${t} is below the 44px touch minimum`)
    }
  })

  test('focus is visible against a light bar', () => {
    // It used to ring white, which was correct on --brand and invisible now.
    const nav = layout.slice(layout.indexOf('aria-label="Main"'))
    assert.ok(!/ring-white/.test(nav))
    assert.match(nav, /focus-visible:ring-\[var\(--accent\)\]/)
  })
})

/**
 * ─── THE TYPE SCALE ─────────────────────────────────────────────────────────
 *
 * 963 screens set a size in pixels rather than through a token, which looks
 * like a system nobody uses — until you count them. 91% land exactly on the
 * scale: 13, 12, 14, 15, 11, 17, 22. The convention IS being followed; it is
 * simply written out longhand, and rewriting 880 sites would be churn with
 * real regression risk and nothing visible to show for it.
 *
 * The 9% that miss are where the finding is, and it is not what it looked
 * like. 24px appears 40 times — nearly twice as often as --text-display's
 * 22px — because the scale stopped one step below where the screens needed
 * it. A scale that stops short is not ignored, it is worked around.
 */
describe('the type scale covers what the screens ask for', () => {
  const css = readFileSync('app/globals.css', 'utf8')

  test('there is a step for a figure', () => {
    assert.match(css, /--text-figure:\s*24px/)
    assert.match(css, /\.t-figure\s*\{[^}]*var\(--text-figure\)/)
  })

  test('a figure is tabular, so a changing number does not jitter', () => {
    const rule = css.slice(css.indexOf('.t-figure'), css.indexOf('.t-display'))
    assert.match(rule, /font-variant-numeric: tabular-nums/)
  })

  test('nothing is set below the scale’s floor', () => {
    /*
     * --text-micro is 11px and that is the floor. I broke this myself in the
     * tab bar an hour after shipping it: two labels at 10px, to fit them
     * under their icons. A navigation label is read on every screen by
     * everybody, which makes it the worst possible place to save a pixel.
     *
     * A <kbd> shortcut chip is exempt: it is a keyboard glyph, not prose, and
     * it sits beside the text it belongs to.
     */
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (/<kbd/.test(line)) return
        for (const m of line.matchAll(/text-\[(\d+)px\]/g)) {
          if (Number(m[1]) < 11) {
            offenders.push(`${file.replace(/^.*?cambridge\//, '')}:${i + 1} — ${m[0]}`)
          }
        }
      })
    }
    assert.deepEqual(offenders, [],
      'below 11px is smaller than the scale admits and hard to read on a phone')
  })

  test('the tab labels sit on the floor, not under it', () => {
    const layout = readFileSync('components/shared/PortalLayout.tsx', 'utf8')
    const nav = layout.slice(layout.indexOf('aria-label="Main"'))
    assert.match(nav, /text-\[11px\] font-medium/)
    assert.ok(!/text-\[10px\]/.test(nav))
  })
})

/**
 * ─── "WHERE AM I" HAS ONE ANSWER ────────────────────────────────────────────
 *
 * The phone tab bar marks the active destination with a filled dark pill. The
 * desktop sidebar marked the same thing with a pale green tint, and the
 * student portal's own nav with a third variation of the tint.
 *
 * One person uses the sidebar and the tab bar within a minute of each other.
 * A fill also carries further than a tint — an --accent-soft row a third of
 * the way down a list of twenty is easy to scan past, and an administrator's
 * sidebar is long.
 */
describe('every navigation marks the active item the same way', () => {
  const layout = readFileSync('components/shared/PortalLayout.tsx', 'utf8')
  const studentPortal = readFileSync('app/portal/PortalView.tsx', 'utf8')

  test('the staff sidebar fills it', () => {
    const rowClass = layout.slice(layout.indexOf('const rowClass'), layout.indexOf('const rowClass') + 700)
    assert.match(rowClass, /bg-\[var\(--ink\)\] text-\[var\(--paper\)\]/)
    assert.ok(!/bg-\[var\(--accent-soft\)\] text-\[var\(--accent\)\]/.test(rowClass),
      'a tint is the weaker signal and no longer matches the phone')
  })

  test('so does the phone tab bar', () => {
    const nav = layout.slice(layout.indexOf('aria-label="Main"'))
    assert.match(nav, /bg-\[var\(--ink\)\]/)
  })

  test('and the student portal', () => {
    assert.match(studentPortal, /tab === t\.k\s*\n?\s*\? 'bg-\[var\(--ink\)\] text-\[var\(--paper\)\]'/)
  })

  test('all three are pills, not rounded rectangles', () => {
    // The shape is half the signal; a 8px-radius fill reads as a selected
    // table row rather than as a chosen destination.
    const rowClass = layout.slice(layout.indexOf('const rowClass'), layout.indexOf('const rowClass') + 700)
    assert.match(rowClass, /rounded-full/)
    assert.match(layout.slice(layout.indexOf('aria-label="Main"')), /rounded-full/)
    assert.match(studentPortal, /rounded-full text-\[14px\] font-semibold/)
  })

  test('a chosen child link is filled too', () => {
    // A filled parent above a tinted child reads as two different states.
    const children = layout.slice(layout.indexOf('item.children.map'))
    assert.match(children.slice(0, 900), /bg-\[var\(--ink\)\] text-\[var\(--paper\)\]/)
  })
})
