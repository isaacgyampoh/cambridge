import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * DIALOGS ARE THE APPLICATION'S, NOT THE BROWSER'S.
 *
 * ── WHY NOT window.alert / confirm / prompt ────────────────────────────────
 *
 * Thirty-three calls to the native dialogs were spread across ten screens,
 * guarding and reporting real operations: deleting every lead, deleting every
 * staff member, reconciling a Paystack payment, testing an inbound webhook.
 *
 * Three problems, and the third is the one that actually bit:
 *
 *   They cannot be styled, so on a phone they read as a browser warning
 *   rather than part of the product.
 *
 *   They block the main thread.
 *
 *   A browser can be told to stop showing them — the "prevent this page from
 *   creating additional dialogs" tick — and several mobile webviews refuse
 *   window.prompt() outright. After that, prompt() returns null and confirm()
 *   returns false, forever, silently. Every one of these call sites read that
 *   as "the person cancelled". So the button did nothing, said nothing, and
 *   logged nothing, and the member of staff concluded the feature was broken.
 *
 * useConfirm covers all three shapes: confirm() to decide, ask() for a value,
 * notify() to report. None can be suppressed by the browser.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/** Source with comments removed — these files explain the rule in prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n')
}

const ALL = [...sourceFiles('app'), ...sourceFiles('components')]

describe('the browser never puts up our dialogs', () => {
  test('no screen calls alert, prompt or confirm', () => {
    const offenders: string[] = []

    for (const file of ALL) {
      const src = code(readFileSync(file, 'utf8'))

      src.split('\n').forEach((line, i) => {
        for (const fn of ['alert', 'prompt', 'confirm']) {
          // Not a method call (toast.confirm), not our own await confirm({…}).
          const native = new RegExp(`(^|[^.\\w])(window\\.)?${fn}\\s*\\(`)
          if (!native.test(line)) continue
          if (/await confirm|useConfirm|const \{[^}]*confirm/.test(line)) continue
          offenders.push(`${file}:${i + 1} — ${fn}()`)
        }
      })
    }

    assert.deepEqual(offenders, [],
      'use useConfirm — confirm() to decide, ask() for a value, notify() to ' +
      'report. The native ones can be switched off by the browser, after ' +
      'which the action fails silently:\n  ' + offenders.join('\n  '))
  })

  test('a screen that uses the hook also renders its dialog', () => {
    /*
     * The failure this catches is invisible in every other check: destructure
     * `confirm` from the hook, never render `dialog`, and the promise the
     * handler awaits is never resolved by anything. The button appears to do
     * nothing at all — TypeScript is satisfied, the build passes, and the
     * handler simply hangs.
     */
    const offenders: string[] = []

    for (const file of ALL) {
      const src = code(readFileSync(file, 'utf8'))
      if (!/=\s*useConfirm\(\)/.test(src)) continue
      // The hook may legitimately be re-exported or wrapped by another hook,
      // which has no JSX of its own to render into.
      if (!/return\s*\(/.test(src)) continue
      if (!/\{dialog\}/.test(src)) {
        offenders.push(`${file}: calls useConfirm() but never renders {dialog}`)
      }
    }

    assert.deepEqual(offenders, [],
      'the dialog element must be rendered, or every await confirm() hangs ' +
      'forever:\n  ' + offenders.join('\n  '))
  })

  test('an irreversible bulk delete demands a typed phrase', () => {
    /*
     * The two operations that cannot be undone and cannot be reconstructed.
     * A single click is one mis-tap; a phrase has to be read and copied.
     */
    for (const [file, phrase] of [
      ['app/(portal)/admin/leads/page.tsx', 'DELETE ALL LEADS'],
      ['app/(portal)/admin/staff/page.tsx', 'DELETE ALL STAFF'],
    ] as const) {
      const src = readFileSync(file, 'utf8')
      assert.match(src, new RegExp(`requirePhrase:\\s*'${phrase}'`),
        `${file} no longer requires "${phrase}" to be typed`)
    }
  })
})
