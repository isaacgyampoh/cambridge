'use client'
import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Already installed?
    if (window.matchMedia('(display-mode: standalone)').matches) return
    const dismissed = typeof window !== 'undefined' && window.sessionStorage.getItem('cce_install_dismissed')
    const handler = (e: any) => {
      e.preventDefault()
      setDeferred(e)
      if (!dismissed) setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function install() {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
    setShow(false)
  }

  function dismiss() {
    setShow(false)
    try { window.sessionStorage.setItem('cce_install_dismissed', '1') } catch {}
  }

  if (!show) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-[var(--accent)] text-white rounded-xl shadow-lg p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
          <Download size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Install Cambridge CCE</div>
          <div className="text-xs text-white/70">Add it to your device for quick access</div>
        </div>
        <button onClick={install} className="bg-white text-[var(--accent)] text-xs font-semibold px-3 h-8 rounded-lg hover:bg-white/90 transition flex-shrink-0">
          Install
        </button>
        <button onClick={dismiss} className="text-white/60 hover:text-white flex-shrink-0"><X size={16} /></button>
      </div>
    </div>
  )
}
