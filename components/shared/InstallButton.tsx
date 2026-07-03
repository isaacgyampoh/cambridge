'use client'
import { useState } from 'react'
import { useInstallPrompt } from './useInstallPrompt'

/** Sidebar "Install app" button — shows only when installable & not installed. */
export default function InstallButton() {
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt()
  const [showIosTip, setShowIosTip] = useState(false)

  if (installed) return null
  if (!canInstall && !isIOS) return null

  async function onClick() {
    if (isIOS) { setShowIosTip(true); return }
    await promptInstall()
  }

  return (
    <>
      <button onClick={onClick}
        className="w-full flex items-center justify-center gap-1.5 py-2 mb-1.5 rounded-xl text-[12px] font-semibold text-[var(--accent)] bg-[var(--accent-soft)] hover:brightness-95 transition">
        Install app
      </button>
      {showIosTip && (
        <div className="mb-1.5 px-3 py-2 rounded-xl bg-[var(--line-soft)] text-[11px] text-[var(--ink-soft)] leading-relaxed">
          Tap the Share button, then <b>Add to Home Screen</b>.
        </div>
      )}
    </>
  )
}
