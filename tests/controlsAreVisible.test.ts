import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * EVERY CONTROL HAS SOMETHING IN IT.
 *
 * ── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * Six buttons and links shipped with NO CONTENT AT ALL:
 *
 *   marketer/link         the copy button, and the open-in-new-tab link
 *   pm/assign             the refresh button
 *   receptionist          the refresh button
 *   marketer/activities   the call and WhatsApp buttons on every queue row
 *
 * Each rendered as a coloured rectangle with nothing inside it. On the
 * follow-up queue that meant the two controls a marketer uses all day — ring
 * this person, message this person — were 36px tinted squares that gave no
 * indication they could be pressed.
 *
 * The trace was always the same: the icon components were still imported and
 * never referenced. Something stripped the icon or emoji out of the markup
 * and left the wrapper behind. TypeScript is happy, the build is happy, the
 * page renders, and the control is invisible.
 *
 * It is also invisible to assistive technology. An <a> with no text and no
 * aria-label is announced as "link" — no name, no purpose.
 *
 * This test is the check nothing else was making.
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

const ALL = [...sourceFiles('app'), ...sourceFiles('components')]

describe('no control renders as an empty box', () => {
  test('no <button> or <a> has an entirely empty body', () => {
    const offenders: string[] = []

    for (const file of ALL) {
      const src = readFileSync(file, 'utf8')
      // An opening tag, then only whitespace, then its closing tag.
      /*
       * The attribute matcher must survive `>` inside a handler.
       *
       * This was [^>]*, which stops dead at the arrow in
       * onClick={() => close()} — so every empty control with an inline
       * handler, which is most of them, was invisible to this test. It
       * reported clean while a modal shipped with an unlabelled, empty
       * close button.
       */
      for (const m of src.matchAll(/<(a|button)\b(?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*>\s*<\/\1>/g)) {
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(`${file}:${line} — an empty <${m[1]}>`)
      }
    }

    assert.deepEqual(offenders, [],
      'these render as a box with nothing in it, and are announced with no ' +
      'name by a screen reader:\n  ' + offenders.join('\n  '))
  })

  test('an icon-only control carries an accessible name', () => {
    /*
     * A control whose only child is an icon has no text to announce, so it
     * needs aria-label. Restricted to the single-icon case, which is the one
     * that is always wrong without a label — a control with text beside its
     * icon already has a name.
     */
    const offenders: string[] = []

    for (const file of ALL) {
      const src = readFileSync(file, 'utf8')

      for (const m of src.matchAll(/<(a|button)\b((?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*)>\s*(<[A-Z]\w*\s[^>]*\/>)\s*<\/\1>/g)) {
        const [, tag, attrs, child] = m
        const hasName = /aria-label|aria-labelledby|title=/.test(attrs)
        if (hasName) continue

        /*
         * An `alt` on the child IS the name.
         *
         * This test looks for a control whose only child is a component, on
         * the assumption that the component is an icon and so contributes no
         * text. That holds for lucide icons, which is what it was written
         * against — but not for a component that renders an image, where the
         * accessible name computation takes the alt text and the link is
         * announced with it. RemoteImage is the case in hand: a message
         * attachment wrapped in a link to the full-size file.
         *
         * An EMPTY alt is still an offence — alt="" marks an image as
         * decorative, which leaves the link with nothing to announce.
         */
        if (/\salt=(?!["']["'])/.test(child)) continue
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(`${file}:${line} — an icon-only <${tag}> with no aria-label`)
      }
    }

    assert.deepEqual(offenders, [],
      'an icon is not a name — add aria-label:\n  ' + offenders.join('\n  '))
  })

  test('no screen loses its icons', () => {
    /*
     * An icon left in the import list and absent from the markup is the
     * fingerprint of a strip: something removed the icon from a control and
     * left the import behind. That is how six buttons came to render as empty
     * boxes, and how 127 screens across this application ended up importing
     * iconography they never drew.
     *
     * All of them are now clean, so this is asserted outright rather than
     * ratcheted. It costs nothing and it is the only check that sees this.
     */
    const offenders: string[] = []

    for (const file of ALL) {
      const src = readFileSync(file, 'utf8')
      const imp = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/)
      if (!imp) continue

      const body = src.slice(imp.index! + imp[0].length)
      for (const raw of imp[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop()?.trim()
        if (!name) continue
        if (!new RegExp(`\\b${name}\\b`).test(body)) {
          offenders.push(`${file}: imports ${name} and never renders it`)
        }
      }
    }

    assert.deepEqual(offenders, [],
      'an icon imported but never rendered usually means it was stripped out ' +
      'of a control, leaving that control empty:\n  ' + offenders.join('\n  '))
  })
})
