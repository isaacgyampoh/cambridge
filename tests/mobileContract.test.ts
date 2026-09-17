import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WHAT THE PORTAL OWES SOMEBODY HOLDING A PHONE.
 *
 * Three faults here were felt on every single screen, which is why the
 * complaint was "the mobile experience" rather than any one page.
 */

const css = readFileSync('app/globals.css', 'utf8')
const layout = readFileSync('app/layout.tsx', 'utf8')
const ui = readFileSync('components/ui/index.tsx', 'utf8')

function screens(): Array<{ path: string; src: string }> {
  const out: Array<{ path: string; src: string }> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) out.push({ path: p, src: readFileSync(p, 'utf8') })
    }
  }
  walk('app'); walk('components')
  return out
}

describe('tapping a field does not zoom the page', () => {
  test('the shared field classes are 16px on a phone', () => {
    /*
     * iOS Safari zooms whenever a focused field computes below 16px. This was
     * 15, so every form in the portal jumped and zoomed on tap and the person
     * had to pinch back out.
     */
    const input = ui.slice(ui.indexOf('export const inputClass'))
    assert.match(input.slice(0, 400), /text-\[16px\] sm:text-\[14px\]/)
    const textarea = ui.slice(ui.indexOf('export const textareaClass'))
    assert.match(textarea.slice(0, 400), /text-\[16px\] sm:text-\[14px\]/)
  })

  test('neither is below the floor any more', () => {
    for (const decl of ['inputClass', 'textareaClass']) {
      const block = ui.slice(ui.indexOf(`export const ${decl}`))
      /*
       * Only the UNPREFIXED size is the mobile one. `sm:text-[14px]` is the
       * desktop density and is correct — an earlier version of this test
       * flagged it and was wrong.
       */
      const mobileSizes = [...block.slice(0, 400).matchAll(/(^|[\s'"])text-\[(\d+)px\]/g)]
      for (const m of mobileSizes) {
        assert.ok(Number(m[2]) >= 16,
          `${decl} sets a ${m[2]}px field on mobile, which makes iOS zoom`)
      }
    }
  })

  test('and a floor covers the fields written inline', () => {
    // 208 of them across 64 screens do not use the shared classes, and a rule
    // is the only thing that covers one somebody adds tomorrow.
    assert.match(css, /@media \(max-width: 639px\) \{[\s\S]{0,400}font-size: 16px/)
    assert.match(css, /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)/)
  })

  test('the floor does not reach the desktop', () => {
    const block = css.slice(css.indexOf('NO FIELD ON A PHONE'))
    assert.match(block.slice(0, 700), /max-width: 639px/)
  })
})

describe('somebody who needs to zoom in, can', () => {
  test('pinch-zoom is not blocked', () => {
    /*
     * maximumScale: 1 blocks it outright — an accessibility failure, and
     * usually added as a workaround for the focus-zoom above, which is now
     * fixed at the cause.
     */
    const active = layout.replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/maximumScale/.test(active), 'maximumScale blocks pinch-zoom')
    assert.ok(!/userScalable:\s*false/.test(active))
  })
})

describe('the safe area is real', () => {
  test('viewportFit is cover, or every inset is zero', () => {
    /*
     * env(safe-area-inset-*) reports 0 without it. globals.css depends on
     * those insets in eight places, including what keeps the tab bar clear of
     * the iPhone home indicator — all silently evaluating to nothing.
     */
    assert.match(layout, /viewportFit: 'cover'/)
  })

  test('the insets it enables are actually used', () => {
    assert.ok((css.match(/env\(safe-area-inset/g) || []).length >= 8)
    assert.match(css, /padding-bottom: calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\)/)
  })

  test('and the sides are guarded for landscape', () => {
    assert.match(css, /padding-left: env\(safe-area-inset-left\)/)
    assert.match(css, /padding-right: env\(safe-area-inset-right\)/)
  })
})

describe('the tab bar does not sit on top of the page', () => {
  test('content reserves room for it', () => {
    assert.match(css, /\.has-tabbar[\s\S]{0,200}padding-bottom: calc\(var\(--tabbar-h\)/)
  })

  test('and the layout applies that to every screen', () => {
    assert.match(readFileSync('components/shared/PortalLayout.tsx', 'utf8'), /has-tabbar/)
  })
})

describe('a fixed height matches the real viewport', () => {
  test('no screen builds a fixed height from 100vh', () => {
    /*
     * On a phone 100vh is the viewport with the address bar HIDDEN, so a
     * fixed height built from it is taller than what is on screen. In
     * Messages that pushed the composer and its send button out of reach.
     */
    for (const { path, src } of screens()) {
      for (const m of src.matchAll(/h-\[calc\(100vh[^\]]*\]/g)) {
        assert.fail(`${path} sizes a panel from 100vh: ${m[0]}`)
      }
    }
  })

  test('Messages uses dvh and clears the tab bar', () => {
    const msg = readFileSync('app/(portal)/messages/page.tsx', 'utf8')
    assert.match(msg, /100dvh-var\(--tabbar-h\)/)
  })
})

describe('nothing forces the page sideways', () => {
  test('no screen sets a min-width wider than a small phone', () => {
    for (const { path, src } of screens()) {
      for (const m of src.matchAll(/min-w-\[(\d+)px\]/g)) {
        assert.ok(Number(m[1]) <= 320,
          `${path} sets min-width ${m[1]}px, wider than a 320px phone`)
      }
    }
  })

  test('the page itself cannot scroll horizontally', () => {
    assert.match(readFileSync('components/shared/PortalLayout.tsx', 'utf8'), /overflow-x-hidden/)
  })
})
