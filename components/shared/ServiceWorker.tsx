'use client'
import { useEffect } from 'react'

/**
 * Registers the service worker, and rescues anyone an old one trapped.
 *
 * ── WHY THIS IS MORE THAN ONE LINE NOW ─────────────────────────────────────
 *
 * The previous service worker precached `/` while it briefly served the public
 * marketing page, under a cache name that never changed — so it could not age
 * out — and served that copy whenever a navigation's network request failed.
 * Staff on mobile data opened the installed app and got a page about courses
 * instead of the sign-in box.
 *
 * Two things are needed to end that for somebody it has already happened to,
 * and neither is "uninstall the app":
 *
 *   1. The browser must NOTICE the new worker. It checks /sw.js on navigation,
 *      and production serves it `must-revalidate`, so it will — but a device
 *      sitting on an open tab may not navigate for hours. update() asks
 *      directly.
 *
 *   2. The page must reload once the new worker has cleared the old cache.
 *      Otherwise the person is still looking at the stale page until they
 *      happen to close and reopen the app.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    /*
     * Reload once, and only once.
     *
     * sessionStorage rather than a ref: the reload destroys the component, so
     * a ref would be back at its initial value on the other side and the page
     * would reload again, and again. The key is cleared when the tab closes,
     * which is the right lifetime — a genuinely new session should be allowed
     * one reload of its own.
     */
    function reloadOnce() {
      try {
        const KEY = 'cce_sw_reloaded'
        if (sessionStorage.getItem(KEY)) return
        sessionStorage.setItem(KEY, '1')
      } catch {
        // Storage blocked. Better to skip the reload than to risk a loop.
        return
      }
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'cce-cache-purged') reloadOnce()
    })

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Ask now rather than waiting for the next navigation.
        reg.update().catch(() => {})
      })
      .catch(() => {})
  }, [])

  return null
}
