import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A PROP COPIED INTO useState IS A PROP THAT STOPS UPDATING.
 *
 * useState keeps only its FIRST argument. The initialiser runs once, on
 * mount, and every later value of whatever it read is ignored — silently,
 * with no warning from React, no type error and no failing test. The
 * component simply shows the first value for the rest of its life.
 *
 * Two of these were live in this codebase, and neither was findable except by
 * opening the page and pressing a button:
 *
 *   - PortalView latched `demoData`, so /portal/demo — the page the product
 *     gets demonstrated with — highlighted the state button you pressed and
 *     went on showing the first state. "Paid up — can join" left "Payment
 *     required to join" on screen; "Cohort finished" never appeared at all.
 *
 *   - FileUpload latched `value`. On the certificates screen the upload sits
 *     beside a "…or paste a PDF link" box, both bound to the same certUrl,
 *     and pasting a link updated the box while the preview went on showing
 *     nothing — so an administrator pasted a valid link with no sign it had
 *     registered.
 *
 * There are two correct shapes. Derive the value (`const d = demo ? demoData
 * : fetched`), or adjust during render against a remembered copy, which is
 * what ConfirmDialog does with `wasOpen` and FileUpload now does with
 * `lastValue`. Either is fine. Latching and hoping is not.
 */

function componentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) componentFiles(full, out)
    else if (/\.tsx$/.test(entry)) out.push(full)
  }
  return out
}

const ALL = [...componentFiles('app'), ...componentFiles('components')]

describe('no prop is latched into state and forgotten', () => {
  test('every useState seeded from a prop resynchronises', () => {
    const offenders: string[] = []

    for (const file of ALL) {
      const raw = readFileSync(file, 'utf8')
      // Comments explain past bugs by quoting them; they are not code.
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

      // Destructured component parameters.
      const props = new Set<string>()
      for (const m of src.matchAll(/function\s+\w+\s*\(\s*\{([^}]*)\}\s*:/g)) {
        for (const part of m[1].split(',')) {
          const name = part.trim().split(/[:=]/)[0].trim()
          if (/^\w+$/.test(name)) props.add(name)
        }
      }
      if (!props.size) continue

      src.split('\n').forEach((line, i) => {
        const m = line.match(/useState[^(]*\(\s*([^)]*)\)/)
        if (!m) return
        const init = m[1]
        // A lazy initialiser is a deliberate "seed once" and reads the same.
        if (!init || /^\(\)\s*=>/.test(init)) return

        for (const prop of props) {
          if (!new RegExp(`\\b${prop}\\b`).test(init)) continue

          /*
           * Resynchronised if the file adjusts against this prop during
           * render — `if (prop !== lastX)` — or derives from it outside the
           * useState call. Both are the correct shapes.
           */
          const resyncs =
            new RegExp(`if\\s*\\(\\s*${prop}\\s*!==`).test(src) ||
            new RegExp(`const \\w+ = ${prop} \\?`).test(src)

          // A prop that cannot change for a mounted component is not a risk:
          // `demo` decides which component tree exists at all.
          const invariant = ['demo'].includes(prop)

          if (!resyncs && !invariant) {
            offenders.push(`${file}:${i + 1} — "${prop}" -> ${line.trim().slice(0, 90)}`)
          }
          break
        }
      })
    }

    assert.deepEqual(offenders, [],
      'these copy a prop into state on mount and never look at it again. ' +
      'The parent can change it and the screen will not:\n  ' + offenders.join('\n  '))
  })
})

describe('the two that were wrong stay fixed', () => {
  test('FileUpload follows a value the parent changes', () => {
    const src = readFileSync('components/shared/FileUpload.tsx', 'utf8')
    assert.match(src, /if \(value !== undefined && value !== lastValue\)/,
      'the preview is latched at mount again — pasting a link will show nothing')
    // Undefined means uncontrolled. Resyncing then would wipe the thumbnail
    // the instant an upload finished, because no parent sends the value back.
    assert.match(src, /value !== undefined/,
      'an uncontrolled FileUpload would have its preview cleared after upload')
  })

  test('PortalView derives the demo data rather than storing it', () => {
    const src = readFileSync('app/portal/PortalView.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    assert.match(src, /const d = demo \? demoData \?\? null : fetched/,
      'the demo shows the first state whatever the visitor presses')
  })
})
