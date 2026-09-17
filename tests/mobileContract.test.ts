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

describe('it behaves like an app, not a page', () => {
  test('a tap is not held back waiting for a double-tap', () => {
    assert.match(css, /touch-action: manipulation/)
  })

  test('but pinch-zoom on content is still allowed', () => {
    // touch-action is scoped to controls; putting it on body would take back
    // the zoom that was just restored.
    const block = css.slice(css.indexOf('touch-action: manipulation') - 400, css.indexOf('touch-action: manipulation'))
    assert.ok(!/^body\s*\{/m.test(block), 'touch-action must not be applied to the whole body')
  })

  test('the shell does not rubber-band past its ends', () => {
    assert.match(css, /overscroll-behavior-y: contain/)
  })

  test('turning the phone does not resize the text', () => {
    assert.match(css, /-webkit-text-size-adjust: 100%/)
  })

  test('a long press on navigation does not raise the copy menu', () => {
    assert.match(css, /nav, \.tab-bar, \.appbar, \[role='tablist'\], th \{[\s\S]{0,120}user-select: none/)
  })

  test('but a lead name or phone number stays selectable', () => {
    // Copying those is real work people do here.
    const block = css.slice(css.indexOf("user-select: none") - 600, css.indexOf("user-select: none") + 200)
    assert.ok(!/^\s*body\s*\{[^}]*user-select:\s*none/m.test(block))
    assert.ok(!/\*\s*\{[^}]*user-select:\s*none/.test(css))
  })
})

describe('nothing floats on top of the navigation', () => {
  test('the install banner clears the tab bar', () => {
    const src = readFileSync('components/shared/InstallPrompt.tsx', 'utf8')
    assert.match(src, /fixed above-tabbar/)
    assert.ok(!/fixed bottom-4/.test(src), 'it sat on the navigation and covered it')
  })

  test('so does the assistant button', () => {
    const src = readFileSync('components/shared/GyampohAI.tsx', 'utf8')
    assert.match(src, /fixed above-tabbar/)
    assert.ok(!/fixed bottom-5/.test(src))
  })

  test('and the offset is defined once, disappearing where there is no tab bar', () => {
    assert.match(css, /\.above-tabbar \{[\s\S]{0,120}calc\(var\(--tabbar-h\)/)
    assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]{0,120}\.above-tabbar/)
  })

  test('the assistant sits below the tab bar in the stack, not above it', () => {
    assert.match(readFileSync('components/shared/GyampohAI.tsx', 'utf8'), /z-30/)
  })
})

describe('the installed app', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'))

  test('it has a stable identity and its own scope', () => {
    assert.equal(manifest.id, '/')
    assert.equal(manifest.scope, '/')
    assert.equal(manifest.display, 'standalone')
  })

  test('tapping the icon returns to the window already open', () => {
    assert.deepEqual(manifest.launch_handler, { client_mode: 'focus-existing' })
  })

  test('a long press on the icon offers the work people actually do', () => {
    const urls = (manifest.shortcuts || []).map((s: { url: string }) => s.url)
    assert.ok(urls.length >= 3, 'no home-screen shortcuts')
    assert.ok(urls.includes('/marketer/leads'))
    assert.ok(urls.includes('/marketer/leads/new'))
  })

  test('every shortcut points somewhere real', () => {
    for (const s of manifest.shortcuts || []) {
      const path = s.url.split('?')[0]
      const candidates = [`app${path}/page.tsx`, `app/(portal)${path}/page.tsx`]
      assert.ok(candidates.some(c => { try { readFileSync(c); return true } catch { return false } }),
        `shortcut ${s.url} has no page`)
    }
  })

  test('it has maskable icons, so Android does not letterbox it', () => {
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose)
    assert.ok(purposes.includes('maskable'))
    assert.ok(purposes.includes('any'))
  })

  test('the theme colour agrees with the document and the stylesheet', () => {
    // Two copies of one colour is how the browser chrome ends up a different
    // green from the application it frames.
    assert.equal(manifest.theme_color, '#15664D')
    assert.match(layout, /themeColor: '#15664D'/)
    assert.match(css, /--brand:\s*#15664D/)
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
