import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * OPENING THE INSTALLED APP LANDS ON THE STAFF PORTAL.
 *
 * ── WHAT WAS ACTUALLY WRONG ────────────────────────────────────────────────
 *
 * Staff opened the PWA and got the public marketing page instead of the
 * sign-in box — some of them, sometimes, which is what made it look like a
 * routing fault. It was not. `/` has redirected to /login since 3abc361.
 *
 * The old application shell was being served by the service worker:
 *
 *   1. SHELL = ['/', …] precached the ROOT DOCUMENT at install, so anyone who
 *      opened the site while `/` served the marketing page (6e2de5a until
 *      3abc361) had that HTML stored.
 *   2. CACHE = 'cce-v1' never changed, and activate only deletes caches whose
 *      key differs from the current one — so the poisoned entry survived every
 *      deployment and could not age out.
 *   3. The network-first fetch handler could not heal it: `/` now answers 307,
 *      cache.put() rejects a redirected response, and that rejection was
 *      swallowed. The failure path then served `caches.match('/')` for ANY
 *      navigation whose fetch failed.
 *
 * One dropped request on mobile data handed a member of staff a marketing
 * page, from a cache nothing could clear.
 */

const sw = readFileSync('public/sw.js', 'utf8')
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'))

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

const swCode = sw
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/^\s*\/\/.*$/gm, '')

describe('the service worker never serves a document from cache', () => {
  test('nothing is precached', () => {
    // Precaching is what put a document in there in the first place.
    assert.ok(!/addAll\(/.test(swCode), 'addAll precaches; that is how the marketing page got in.')
    assert.ok(!/const SHELL/.test(swCode))
  })

  test('a navigation goes to the network and is never stored', () => {
    assert.match(swCode, /request\.mode === 'navigate'/)
    const nav = swCode.slice(swCode.indexOf("request.mode === 'navigate'"))
    const block = nav.slice(0, nav.indexOf('return') + 200)
    assert.ok(!/caches\.put|cache\.put/.test(block),
      'A cached shell is a copy of the application frozen when it was stored.')
  })

  test('a failed navigation gets an offline page, never another URL', () => {
    /*
     * The old fallback was `caches.match('/')` — a DIFFERENT document served
     * in place of the one asked for. That is precisely how a member of staff
     * requesting the portal received the marketing page.
     */
    assert.ok(!/caches\.match\('\/'\)/.test(swCode),
      'Serving the cached root for a failed navigation is the original bug.')
    assert.match(swCode, /OFFLINE_PAGE/)
  })

  test('only content-addressed assets are cached', () => {
    assert.match(swCode, /\/_next\/static\//)
    const fn = swCode.slice(swCode.indexOf('function isCacheableAsset'), swCode.indexOf('self.addEventListener'))
    assert.ok(!fn.includes("'/'"), 'The root must not be cacheable.')
  })

  test('an API response is never cached', () => {
    // Authenticated data in a cache shared by everyone using this browser.
    assert.match(swCode, /pathname\.startsWith\('\/api\/'\)/)
  })

  test('a redirected or failed response is never stored', () => {
    // cache.put on a redirect is what silently failed before.
    assert.match(swCode, /res\.ok && res\.status === 200 && !res\.redirected/)
  })
})

describe('an already-poisoned install heals itself', () => {
  test('the cache name changed, so the old one is deleted', () => {
    assert.ok(!/'cce-v1'/.test(swCode), "'cce-v1' is the cache holding the marketing page.")
    assert.match(swCode, /const CACHE = 'cce-static-v2'/)
  })

  test('activate deletes every cache that is not the current one', () => {
    assert.match(swCode, /keys\.filter\(\(k\) => k !== CACHE\)\.map\(\(k\) => caches\.delete\(k\)\)/)
  })

  test('the new worker takes over immediately', () => {
    assert.match(swCode, /skipWaiting\(\)/)
    assert.match(swCode, /clients\.claim\(\)/)
  })

  test('and open pages are told to reload once', () => {
    /*
     * Without this, somebody looking at the stale page right now keeps
     * looking at it until they close and reopen the app — and the whole point
     * is that they should not have to do anything.
     */
    assert.match(swCode, /cce-cache-purged/)
    const reg = codeOf('components/shared/ServiceWorker.tsx')
    assert.match(reg, /cce-cache-purged/)
    assert.match(reg, /location\.reload\(\)/)
  })

  test('the reload cannot loop', () => {
    const reg = codeOf('components/shared/ServiceWorker.tsx')
    assert.match(reg, /sessionStorage/,
      'A ref resets across the reload, so the guard must outlive it.')
    assert.match(reg, /if \(sessionStorage\.getItem\(KEY\)\) return/)
  })

  test('the worker is asked for an update rather than waited for', () => {
    assert.match(codeOf('components/shared/ServiceWorker.tsx'), /reg\.update\(\)/)
  })
})

describe('the PWA opens the staff portal', () => {
  test('start_url is the application root', () => {
    assert.equal(manifest.start_url, '/')
    assert.equal(manifest.display, 'standalone')
  })

  test('and the root is the staff sign-in, not marketing', () => {
    const root = codeOf('app/page.tsx')
    assert.match(root, /redirect\('\/login'\)/)
    // The public page exists, but at its own address.
    assert.ok(!/welcome/.test(root.replace(/\s+/g, ' ')) || root.includes("redirect('/login')"))
  })

  test('the marketing page is still reachable at /welcome', () => {
    // Restoring the portal front door must not delete the public page.
    assert.doesNotThrow(() => readFileSync('app/welcome/page.tsx', 'utf8'))
  })
})

describe('a signed-in staff member is not asked for their PIN again', () => {
  const login = codeOf('app/(auth)/login/page.tsx')

  test('a live session is returned to its portal', () => {
    /*
     * The PWA starts at `/`, which redirects here — so without this, somebody
     * whose session is valid for another eighty-nine days was asked for their
     * PIN every time they opened the app they use all day.
     */
    assert.match(login, /verifySession\(token\)/)
    assert.match(login, /ROLE_HOME\[session\.role\]/)
    assert.match(login, /redirect\(destination\)/)
  })

  test('it reuses the existing verifier and role map', () => {
    assert.match(login, /from '@\/lib\/auth\/pin'/)
    assert.match(login, /from '@\/lib\/access\/portals'/)
    assert.ok(!/pin_sessions/.test(login), 'No second authentication path.')
  })

  test('an unverifiable session shows the form rather than admitting anybody', () => {
    assert.match(login, /session\.failed \|\| !session\.valid/)
  })
})

describe('an unverifiable session is not reported as an expired one', () => {
  test('verifySession says which it was', () => {
    /*
     * Both used to arrive as `{ valid: false }`, and every caller reads that
     * as "signed out" — so one unreadable moment told every member of staff
     * their session had expired, on every request at once.
     */
    const pin = codeOf('lib/auth/pin.ts')
    assert.match(pin, /const \{ data, error \} = await sb\.from\('pin_sessions'\)/)
    assert.match(pin, /return \{ valid: false, failed: error\.message \}/)
  })

  test('and the API guard answers 503, not 401', () => {
    // 401 is what the client treats as "sign in again".
    const guard = codeOf('lib/auth/guard.ts')
    assert.match(guard, /if \(session\.failed\)[\s\S]{0,220}503/)
    // A genuinely expired session must still say so.
    assert.match(guard, /401, 'Your session has expired/)
  })
})
