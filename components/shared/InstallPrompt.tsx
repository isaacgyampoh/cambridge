'use client'
import { useState, useEffect } from 'react'
import { Download, X, Share } from 'lucide-react'

/**
 * Shows an "Install app" affordance so staff can add the app to their phone.
 * - Android/Chrome: captures the beforeinstallprompt event and offers a
 *   one-tap install button.
 * - iOS Safari: shows the manual "Share -> Add to Home Screen" hint, since
 *   iOS has no programmatic install.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null)
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Already installed? Don't show.
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone
    if (standalone) return

    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    setIsIOS(ios)

    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); setShow(true) }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // On iOS there's no event; show the hint after a moment if not dismissed
    if (ios) {
      const seen = sessionStorage?.getItem?.('ios-install-hint')
      if (!seen) setTimeout(() => setShow(true), 2500)
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  async function install() {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    setDeferred(null); setShow(false)
  }

  function close() {
    setShow(false); setDismissed(true)
    try { sessionStorage.setItem('ios-install-hint', '1') } catch {}
  }

  if (!show || dismissed) return null

  return (
    <div className="fixed bottom-4 inset-x-4 z-[60] mx-auto max-w-md">
      <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-lg p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
          <Download size={18} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[var(--ink)] text-sm">Install the app</div>
          {isIOS ? (
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Tap <Share size={12} className="inline -mt-0.5" /> Share, then “Add to Home Screen”.
            </p>
          ) : (
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">Add Cambridge CCE to your home screen for quick access.</p>
          )}
          {!isIOS && (
            <button onClick={install} className="mt-2 h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium">
              Install now
            </button>
          )}
        </div>
        <button onClick={close} className="text-[var(--ink-faint)] hover:text-[var(--ink)] flex-shrink-0"><X size={18} /></button>
      </div>
    </div>
  )
}
