'use client'
import { useState, useEffect } from 'react'

/**
 * Shows a small "Install app" button when the browser reports the PWA is
 * installable (Android/Chrome/Edge fire beforeinstallprompt). iOS Safari
 * doesn't fire it, so we show a short hint there instead.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null)
  const [show, setShow] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    // Already installed? Don't show.
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); setShow(true) }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // iOS Safari detection (no beforeinstallprompt there)
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isSafari = /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)
    if (isIOS && isSafari && !localStorage.getItem('ios-install-dismissed')) {
      setTimeout(() => setIosHint(true), 3000)
    }

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  async function install() {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    setDeferred(null); setShow(false)
  }

  if (show) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-[60] bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-2xl p-4">
        <div className="font-semibold text-[var(--ink)] text-[15px]">Install Cambridge portal</div>
        <p className="text-[13px] text-[var(--ink-soft)] mt-1 leading-relaxed">Add the portal to your home screen for quick access, like a normal app.</p>
        <div className="flex gap-2 mt-3">
          <button onClick={install} className="h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold">Install</button>
          <button onClick={() => setShow(false)} className="h-9 px-4 rounded-lg text-[var(--ink-soft)] text-sm font-medium">Not now</button>
        </div>
      </div>
    )
  }

  if (iosHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-[60] bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-2xl p-4">
        <div className="font-semibold text-[var(--ink)] text-[15px]">Install this app</div>
        <p className="text-[13px] text-[var(--ink-soft)] mt-1 leading-relaxed">Tap the Share button below, then choose <b>Add to Home Screen</b>.</p>
        <button onClick={() => { localStorage.setItem('ios-install-dismissed', '1'); setIosHint(false) }}
          className="h-9 px-4 rounded-lg text-[var(--ink-soft)] text-sm font-medium mt-2">Got it</button>
      </div>
    )
  }

  return null
}
