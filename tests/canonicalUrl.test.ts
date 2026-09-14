import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CANONICAL_ORIGIN, publicUrl, canonicalisePublicUrl } from '../lib/url.ts'

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
      // lib/url.ts names these hosts on purpose: it is the file that REPAIRS
      // them. Everywhere else, naming one means building a link from it.
      if (f.endsWith('lib/url.ts')) continue
      const src = codeOf(f)
      if (/vercel\.app/.test(src)) offenders.push(`${f} — vercel.app`)
      if (/localhost:\d+/.test(src)) offenders.push(`${f} — localhost`)
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

describe('a link stored on a deployment address is repaired', () => {
  /*
   * The bad URLs were not in the code. No code builds a /brochures/ path —
   * they are stored absolute in courses.brochure_url, written while
   * NEXT_PUBLIC_APP_URL pointed at the deployment alias. Fixing the code could
   * not reach them, because the code was never what produced them.
   */
  test('a vercel.app origin becomes the centre, path intact', () => {
    assert.equal(
      canonicalisePublicUrl('https://cambridge-mu.vercel.app/brochures/pmp-brochure.pdf'),
      'https://portal.cambridge.edu.gh/brochures/pmp-brochure.pdf',
    )
    assert.equal(
      canonicalisePublicUrl('https://cambridge-abc123-x.vercel.app/f/1?a=b#c'),
      'https://portal.cambridge.edu.gh/f/1?a=b#c',
    )
  })

  test('so does a localhost one, baked in by somebody\u2019s build', () => {
    assert.equal(
      canonicalisePublicUrl('http://localhost:3000/brochures/hr.pdf'),
      'https://portal.cambridge.edu.gh/brochures/hr.pdf',
    )
  })

  test('a genuine third-party host is left completely alone', () => {
    /*
     * This is the half that must not over-reach. Flyer artwork lives on
     * Cloudinary; rewriting those would break every image on the site.
     */
    for (const external of [
      'https://res.cloudinary.com/demo/image/upload/v1/flyer.jpg',
      'https://gejtxkbatldxbbqynpfg.supabase.co/storage/v1/object/public/x.png',
      'https://portal.cambridge.edu.gh/brochures/pmp.pdf',
    ]) {
      assert.equal(canonicalisePublicUrl(external), external, `must not rewrite: ${external}`)
    }
  })

  test('a relative path is already correct', () => {
    // It resolves against whatever host served the page, which is right.
    assert.equal(canonicalisePublicUrl('/brochures/pmp.pdf'), '/brochures/pmp.pdf')
  })

  test('nothing is discarded when the value is not a URL', () => {
    assert.equal(canonicalisePublicUrl('not a url'), 'not a url')
    assert.equal(canonicalisePublicUrl(''), null)
    assert.equal(canonicalisePublicUrl(null), null)
  })

  test('the canonical loader repairs brochures for every consumer', () => {
    // The public page, the marketing page and the chatbot all read through it.
    assert.match(codeOf('lib/chatbot/programme.ts'), /brochureUrl: canonicalisePublicUrl\(r\.brochure_url\)/)
  })

  test('and flyer images are repaired where they are served', () => {
    assert.match(codeOf('lib/flyers/publicFlyer.ts'), /canonicalisePublicUrl\(data\.image_url\)/)
    assert.match(codeOf('lib/marketing/link.ts'), /canonicalisePublicUrl\(chosen\.image_url\)/)
  })

  test('the migration corrects the rows too, and only ours', () => {
    // SQL comments stripped: the file EXPLAINS that Cloudinary is left alone,
    // and the assertion below is about the statements, not the prose.
    const sql = readFileSync('supabase/migrations/0020_canonical_public_urls.sql', 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    assert.ok(sql.includes('vercel'), 'It must target deployment aliases.')
    assert.ok(sql.includes('localhost'), 'And builds that baked in localhost.')
    // Only the origin is replaced; the path is preserved by regexp_replace.
    assert.ok(sql.includes("regexp_replace(brochure_url, '^https?://[^/]+', '')"))
    assert.ok(sql.includes("'https://portal.cambridge.edu.gh'"))
    assert.ok(!/cloudinary/i.test(sql), 'A third-party host must never be rewritten.')
    // All three places a public URL is stored.
    for (const table of ['courses', 'flyers', 'documents']) {
      assert.ok(sql.includes(`UPDATE ${table}`), `${table} still holds stored links.`)
    }
  })
})
