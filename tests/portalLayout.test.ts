import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE TWO LAYOUT FAULTS STAFF ACTUALLY REPORTED.
 *
 * On a desktop the application sat in a narrow column against the left edge
 * with dead space to its right. On a phone, "More" opened a menu that showed
 * the first few sections and could not be scrolled — Staff, Settings,
 * Documents, the personal flyer and the marketing links were simply not
 * reachable from a phone at all.
 *
 * Both were one CSS mistake each, and neither was in the navigation model:
 * the drawer has always rendered navFor(), the same canonical definition the
 * desktop sidebar renders.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Source with comments blanked.
 *
 * The comments here quote the broken values on purpose — `max-h-[86vh]`, the
 * vh unit — so an assertion that "the old value is gone" would match the
 * explanation of why it went and fail against correct code.
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
}

const layout = codeOf('components/shared/PortalLayout.tsx')

describe('the desktop portal is not pinned to the left edge', () => {
  test('no screen constrains its width without centring it', () => {
    /*
     * This was the whole bug. `max-w-5xl` with no `mx-auto` renders a 1024px
     * column hard against the left of a much wider content area — including
     * on the dashboard, which is the first screen every role sees.
     */
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('components')]) {
      const src = codeOf(file)
      for (const m of src.matchAll(/className="([^"]*\bmax-w-(?:2xl|3xl|4xl|5xl|6xl|7xl)\b[^"]*)"/g)) {
        const cls = m[1]
        // A centred column, a flex/grid child, or an absolutely placed layer
        // is positioned by something other than its own margins.
        if (/mx-auto|absolute|fixed|flex-1|self-/.test(cls)) continue
        offenders.push(`${file.replace(/^.*?cambridge\//, '')} — ${cls.slice(0, 54)}`)
      }
    }
    assert.deepEqual(offenders, [],
      'a constrained column with no mx-auto sits against the left edge')
  })

  test('the dashboard every role lands on is centred', () => {
    const overview = codeOf('components/dashboard/Overview.tsx')
    assert.match(overview, /className="fade-in w-full max-w-5xl mx-auto"/)
  })

  test('the sidebar stands beside the page rather than over it', () => {
    // It is part of the workspace on lg and up; the content is its sibling.
    assert.match(layout, /<aside\s*\n?\s*className="hidden lg:flex flex-col flex-shrink-0/)
    assert.match(layout, /<div className="flex flex-col flex-1 min-w-0 overflow-hidden">/)
  })
})

describe('the More sheet on a phone can actually scroll', () => {
  test('its height is definite, not a maximum', () => {
    /*
     * A percentage height resolves against a DEFINITE parent height, and
     * max-height does not give one. With `max-h-[86vh]` the sidebar's
     * `h-full` behaved as auto, the list grew to its content, and
     * overflow-hidden cut it off — so the scroll container never received a
     * height to scroll within. The items past the fold were not hidden, they
     * were clipped away.
     */
    assert.match(layout, /absolute inset-x-0 bottom-0 h-\[86dvh\] flex flex-col/)
    assert.ok(!/max-h-\[86vh\]/.test(layout))
  })

  test('and dvh, because vh ignores the address bar', () => {
    // vh is the LARGE viewport on mobile browsers, so 86vh reaches under the
    // chrome and the last item sits below the fold even once scrolling works.
    assert.ok(!/h-\[\d+vh\]/.test(layout), 'vh on a phone sheet is the wrong unit')
  })

  test('the column is allowed to shrink below its content', () => {
    // Without min-h-0 a flex column refuses to, and flex-1 overflow-y-auto
    // never becomes a scroll area.
    assert.match(layout, /flex flex-col h-full min-h-0 bg-\[var\(--paper\)\]/)
    assert.match(layout, /<nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain/)
  })

  test('scrolling the sheet does not scroll the page behind it', () => {
    assert.match(layout, /overscroll-contain/)
  })

  test('it renders the canonical navigation, not a second list', () => {
    /*
     * The reported symptom looked like missing items, so the tempting fix is
     * a hand-written mobile menu. There was never a second list: the drawer
     * has always rendered navFor(), exactly as the desktop sidebar does.
     */
    assert.match(layout, /const sections: NavSection\[\] = useMemo\(\s*\n?\s*\(\) => \(profile \? navFor\(profile\.role, portals\)/)
    assert.match(layout, /\{sidebar\(\{ wide: true, inDrawer: true \}\)\}/)
    assert.match(layout, /\{navList\(wide\)\}/)
  })

  test('and closes itself when a link navigates', () => {
    // drawerOpen is a comparison against the current path, so a route change
    // closes it without anything having to remember to.
    assert.match(layout, /const drawerOpen = drawerPath === pathname/)
  })
})
