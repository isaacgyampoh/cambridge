'use client'
import { useState, useEffect } from 'react'

/**
 * Shared PWA-install state. Captures the browser's beforeinstallprompt so we
 * can trigger the native installer from anywhere (banner OR sidebar button).
 * Note: browsers require a user click to install — there is no silent auto-
 * install. We make the prompt prominent and persistent until installed.
 */
let deferredEvent: any = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: any) => {
    e.preventDefault()
    deferredEvent = e
    listeners.forEach(fn => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferredEvent = null
    try { localStorage.setItem('pwa-installed', '1') } catch {}
    listeners.forEach(fn => fn())
  })
}

export function useInstallPrompt() {
  const [, force] = useState(0)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const check = () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches
        || (window.navigator as any).standalone === true
        || localStorage.getItem('pwa-installed') === '1'
      setInstalled(standalone)
      force(n => n + 1)
    }
    check()
    listeners.add(check)
    return () => { listeners.delete(check) }
  }, [])

  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isSafari = typeof navigator !== 'undefined' && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)

  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferredEvent) return 'unavailable'
    deferredEvent.prompt()
    const { outcome } = await deferredEvent.userChoice
    if (outcome === 'accepted') { deferredEvent = null }
    listeners.forEach(fn => fn())
    return outcome
  }

  return {
    canInstall: !!deferredEvent,   // Android/desktop native prompt available
    installed,
    isIOS: isIOS && isSafari,      // iOS needs the manual Share -> Add to Home Screen
    promptInstall,
  }
}
