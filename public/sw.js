/*
 * Cambridge CCE service worker.
 *
 * ── THE BUG THIS REPLACES ──────────────────────────────────────────────────
 *
 * Staff opened the installed app and got the public marketing page instead of
 * the sign-in box — not all of them, and not every time, which is what made it
 * look like a routing fault. It was not. `/` has redirected to /login since
 * commit 3abc361. The old application shell was being served from this file.
 *
 * Three faults compounded:
 *
 *   1. SHELL = ['/', …] precached the ROOT DOCUMENT at install. For anyone who
 *      opened the app during the window when `/` served the marketing page
 *      (6e2de5a until 3abc361), that HTML went into the cache.
 *
 *   2. CACHE = 'cce-v1' never changed. The activate handler deletes every
 *      cache whose key is not the current one — but the current one has been
 *      called 'cce-v1' since the beginning, so the poisoned entry survived
 *      every single deployment. It could not age out.
 *
 *   3. The fetch handler was network-first, which should have healed it, and
 *      could not: `/` now answers 307, and cache.put() rejects a redirected
 *      response. That rejection went into `.catch(() => {})`, so the stale
 *      copy was never overwritten — and the failure path,
 *      `caches.match(request).then(r => r || caches.match('/'))`, served that
 *      copy for ANY navigation whose network fetch failed.
 *
 * So one dropped request on mobile data — routine in Accra — handed a member
 * of staff a marketing page, from a cache nothing could clear.
 *
 * ── WHAT THIS DOES INSTEAD ─────────────────────────────────────────────────
 *
 * It never caches a document. Not the root, not a portal page, not anything
 * that renders HTML. Two reasons, and either alone is sufficient:
 *
 *   - Correctness. A cached shell is a copy of the application frozen at the
 *     moment it was stored, and every bug above came from one.
 *   - Privacy. This is an ERP behind a PIN. Portal pages are rendered with
 *     one member of staff's leads in them, and a cache is shared by everyone
 *     who uses that browser profile.
 *
 * What it does cache is the content-addressed build output under
 * /_next/static/, plus the icons. Those are safe to keep for ever precisely
 * because their filenames change when their contents do — so a new deployment
 * cannot be shadowed by an old one, and the cache name no longer has to carry
 * a version for correctness.
 *
 * Offline, a navigation gets the inline page at the bottom of this file. It is
 * built from a string, so it cannot drift from what the application is, and it
 * says the one true thing: this needs a connection.
 */

/*
 * Bumping this deletes every previous cache on activate.
 *
 * It is bumped here because 'cce-v1' must die: it is the cache holding the
 * marketing page. Nothing about correctness depends on bumping it again —
 * static assets are content-addressed — but it remains the lever if a future
 * change ever needs one.
 */
const CACHE = 'cce-static-v2'

/** Only these are ever stored. Everything else goes to the network. */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/brand/')
  )
}

self.addEventListener('install', () => {
  /*
   * Nothing is precached, deliberately.
   *
   * Precaching is what put a document in here in the first place. Assets are
   * stored as they are genuinely requested, which also means the cache only
   * ever holds what this build actually uses.
   */
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Every cache but this one, including 'cce-v1' and whatever it holds.
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))

      await self.clients.claim()

      /*
       * Tell anything already open that its cache has been cleared.
       *
       * Without this, a member of staff looking at the stale marketing page
       * right now keeps looking at it until they close and reopen the app —
       * and the whole point is that they should not have to do anything.
       * The page reloads itself once; see components/shared/ServiceWorker.tsx
       * for the guard that stops it becoming a loop.
       */
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        client.postMessage({ type: 'cce-cache-purged', cache: CACHE })
      }
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e

  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Another origin's problem — Cloudinary images, fonts, Paystack.
  if (url.origin !== self.location.origin) return

  /*
   * Anything that renders a page, or answers with data, goes straight to the
   * network and is never stored. `request.mode === 'navigate'` covers every
   * document load including the PWA opening.
   */
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_PAGE, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    )
    return
  }

  if (url.pathname.startsWith('/api/')) return

  if (!isCacheableAsset(url)) return

  /*
   * Content-addressed assets: cache first, because the URL changes whenever
   * the bytes do. A hit here can never be stale.
   */
  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((res) => {
        // Only a clean, same-origin 200 is worth storing. A redirect or an
        // error page in the asset cache is how this went wrong before.
        if (res.ok && res.status === 200 && !res.redirected) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
        }
        return res
      })
    }),
  )
})

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>No connection</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:#f7f7f5;color:#1a1a18}
@media(prefers-color-scheme:dark){body{background:#14140f;color:#f0efe8}}
.c{max-width:24rem;text-align:center}
h1{font-size:19px;margin:0 0 10px;font-weight:600}
p{margin:0 0 18px;opacity:.75}
button{font:inherit;font-weight:500;padding:11px 22px;border-radius:11px;border:0;
background:#1a1a18;color:#fff;min-height:44px;cursor:pointer}
@media(prefers-color-scheme:dark){button{background:#f0efe8;color:#14140f}}
</style></head><body><div class="c">
<h1>You are offline</h1>
<p>The Cambridge portal needs a connection to sign you in. Check your data or Wi-Fi and try again.</p>
<button type="button" onclick="location.reload()">Try again</button>
</div></body></html>`
