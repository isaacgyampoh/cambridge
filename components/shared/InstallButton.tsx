'use client'
import { useState } from 'react'
import { useInstallPrompt } from './useInstallPrompt'

/** Sidebar "Install app" button — always visible (until installed) so it's
 *  discoverable; falls back to manual instructions when the browser hasn't
 *  fired its native install prompt. */
export default function InstallButton() {
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt()
  const [tip, setTip] = useState('')

  if (installed) return null

  async function onClick() {
    if (canInstall) {
      const outcome = await promptInstall()
      if (outcome === 'unavailable') setTip(manualTip())
      return
    }
    setTip(manualTip())
  }

  function manualTip() {
    if (isIOS) return 'On iPhone: tap the Share button, then "Add to Home Screen".'
    const ua = navigator.userAgent
    if (/android/i.test(ua)) return 'Tap the browser menu (⋮ top-right), then "Install app" or "Add to Home screen".'
    return 'Open your browser menu and choose "Install Cambridge…", or use the install icon in the address bar.'
  }

  return (
    <>
      <button onClick={onClick}
        className="w-full flex items-center justify-center gap-1.5 py-2 mb-1.5 rounded-xl text-[12px] font-semibold text-[var(--accent)] bg-[var(--accent-soft)] hover:brightness-95 transition">
        Install app
      </button>
      {tip && (
        <div className="mb-1.5 px-3 py-2 rounded-xl bg-[var(--line-soft)] text-[11px] text-[var(--ink-soft)] leading-relaxed">
          {tip}
        </div>
      )}
    </>
  )
}
