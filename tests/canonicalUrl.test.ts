import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CANONICAL_ORIGIN, publicUrl } from '../lib/url.ts'

/**
 * THE CENTRE HAS ONE ADDRESS.
 *
 * ── WHAT CUSTOMERS WERE ACTUALLY SENT ──────────────────────────────────────
 *
 * Every customer-facing link was built from CONFIG.appUrl, which read
 * NEXT_PUBLIC_APP_URL and used the real domain only when that was unset. It
 * was not unset: production had it pointing at cambridge-mu.vercel.app, and
 * .env.local had http://localhost:3000.
 *
 * So the brochure links on the public front page, the marketer's own
 * marketing link, registration links, WhatsApp shares and Open Graph URLs all
 * carried a deployment address. A marketer shared that with a customer, and it
 * is the first thing anybody sees.
 *
 * NEXT_PUBLIC_* is baked into the browser bundle at BUILD time, so a build run
 * on a laptop shipped http://localhost:3000 inside the JavaScript every
 * visitor downloads — a link that cannot work for anybody but the person who
 * built it.
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

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const ALL = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]

describe('one canonical address', () => {
  test('it is the centre’s domain', () => {
    assert.equal(CANONICAL_ORIGIN, 'https://portal.cambridge.edu.gh')
  })

  test('publicUrl builds absolute links on it', () => {
    assert.equal(publicUrl('/m/ada-4f21'), 'https://portal.cambridge.edu.gh/m/ada-4f21')
    assert.equal(publicUrl('m/ada-4f21'), 'https://portal.cambridge.edu.gh/m/ada-4f21')
    assert.equal(publicUrl('/'), 'https://portal.cambridge.edu.gh')
    assert.equal(publicUrl(), 'https://portal.cambridge.edu.gh')
  })
})

describe('no deployment address can reach a customer', () => {
  test('nothing in the codebase builds a link from a vercel or localhost origin', () => {
    const offenders: string[] = []
    for (const f of ALL) {
      const src = codeOf(f)
      if (/vercel\.app/.test(src)) offenders.push(`${f} — vercel.app`)
      if (/localhost:\d+/.test(src) && !f.endsWith('lib/url.ts')) {
        offenders.push(`${f} — localhost`)
      }
    }
    assert.deepEqual(offenders.map(o => o.replace(/^.*?cambridge\//, '')), [],
      `A deployment address is being written into a customer-facing link:\n  ${offenders.join('\n  ')}`)
  })

  test('only lib/url.ts reads the app URL environment variable', () => {
    /*
     * This is the fix. The variable was set wrongly in production and nothing
     * could tell — every caller trusted it. One reader means one place that
     * can be wrong, and in production it is not consulted at all.
     */
    const readers = ALL.filter(f =>
      /NEXT_PUBLIC_APP_URL|process\.env\.APP_URL/.test(codeOf(f)))
      .map(f => f.replace(/^.*?cambridge\//, ''))
    assert.deepEqual(readers, ['lib/url.ts'])
  })

  test('production ignores the variable entirely', () => {
    const src = codeOf('lib/url.ts')
    assert.match(src, /if \(process\.env\.NODE_ENV === 'production'\) return CANONICAL_ORIGIN/,
      'A misconfigured deployment must not be able to change what customers see.')
  })

  test('and development only accepts a localhost value', () => {
    // So a stray deployment URL in somebody's .env cannot leak either.
    assert.match(codeOf('lib/url.ts'), /localhost\|127\\\.0\\\.0\\\.1/)
  })

  test('CONFIG.appUrl comes from it rather than from the environment', () => {
    const src = codeOf('lib/config.ts')
    assert.match(src, /appUrl: publicOrigin\(\)/)
  })
})

describe('the links a customer is actually given', () => {
  test('the marketing link is built on the canonical origin', () => {
    // CONFIG.appUrl now resolves to it, and the marketer screen uses that.
    const page = codeOf('app/(portal)/marketer/link/page.tsx')
    assert.match(page, /\$\{CONFIG\.appUrl\}\/m\//)
    assert.match(page, /\$\{CONFIG\.appUrl\}\/apply\//)
  })

  test('so is the flyer link', () => {
    assert.match(codeOf('app/(portal)/marketer/flyers/page.tsx'), /\$\{CONFIG\.appUrl\}\/f\//)
  })

  test('Open Graph URLs resolve against the canonical origin', () => {
    const layout = codeOf('app/layout.tsx')
    assert.match(layout, /metadataBase: new URL\('https:\/\/portal\.cambridge\.edu\.gh'\)/)
  })
})
