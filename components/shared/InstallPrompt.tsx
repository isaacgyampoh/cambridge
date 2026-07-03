'use client'
import { useState, useEffect } from 'react'
import { useInstallPrompt } from './useInstallPrompt'

/**
 * Prominent install banner. Reappears every session until the app is
 * installed, then never again. On iOS Safari (no native prompt) it shows the
 * manual 'Share -> Add to Home Screen' hint.
 */
export default function InstallPrompt() {
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt()
  const [dismissedThisSession, setDismissedThisSession] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Small delay so it appears after the page settles (feels intentional)
    const t = setTimeout(() => setReady(true), 1500)
    return () => clearTimeout(t)
  }, [])

  if (installed || dismissedThisSession || !ready) return null
  if (!canInstall && !isIOS) return null   // nothing we can offer on this browser

  async function onInstall() {
    const outcome = await promptInstall()
    if (outcome === 'accepted') setDismissedThisSession(true)
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[360px] z-[70] bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-2xl p-4 fade-in">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-white border border-[var(--line)] flex items-center justify-center overflow-hidden p-1 flex-shrink-0">
          <img src="/brand/logo.png" alt="" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--ink)] text-[15px]">Install the Cambridge app</div>
          {isIOS ? (
            <p className="text-[13px] text-[var(--ink-soft)] mt-0.5 leading-relaxed">
              Tap the Share button below, then <b>Add to Home Screen</b> for quick access.
            </p>
          ) : (
            <p className="text-[13px] text-[var(--ink-soft)] mt-0.5 leading-relaxed">
              Add it to your home screen for one-tap access, like a normal app.
            </p>
          )}
          <div className="flex gap-2 mt-3">
            {!isIOS && (
              <button onClick={onInstall} className="h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:brightness-110 transition">Install now</button>
            )}
            <button onClick={() => setDismissedThisSession(true)} className="h-9 px-4 rounded-lg text-[var(--ink-soft)] text-sm font-medium hover:bg-[var(--line-soft)] transition">
              {isIOS ? 'Got it' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
