'use client'
import { useEffect, useState } from 'react'

/**
 * Reads a course material inside the portal.
 *
 * The file is streamed through the server, so its real address is never handed
 * to the browser and cannot be forwarded or sold on. On top of that, the view
 * blanks itself the moment the page is hidden — which is what a screenshot,
 * a screen recording or an app switch triggers on a phone.
 *
 * None of this is unbreakable; anyone determined can photograph a screen. It
 * removes the easy copying, which is what actually costs you sales.
 */
export default function MaterialViewer({
  id, name, onClose,
}: { id: string; name: string; onClose: () => void }) {
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Blank on anything that looks like a capture or a switch away.
    const hide = () => setHidden(true)
    const show = () => setHidden(false)

    const onVisibility = () => (document.hidden ? hide() : show())
    const onKey = (e: KeyboardEvent) => {
      // PrintScreen, and the common capture shortcuts
      if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey) || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault(); hide(); setTimeout(show, 1200)
      }
    }
    const noMenu = (e: Event) => e.preventDefault()

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', hide)
    window.addEventListener('focus', show)
    window.addEventListener('keyup', onKey)
    window.addEventListener('keydown', onKey)
    document.addEventListener('contextmenu', noMenu)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', hide)
      window.removeEventListener('focus', show)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('contextmenu', noMenu)
    }
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90, background: '#0d1418',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: 0,
      }}>
        <button onClick={onClose} aria-label="Close"
          style={{ background: 'none', border: 'none', color: '#fff', display: 'flex', padding: 4 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>Viewing only. Not for sharing.</div>
        </div>
      </div>

      {/* The document */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {error ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
            <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 14, lineHeight: 1.6 }}>{error}</p>
          </div>
        ) : (
          <iframe
            src={`/portal/material/${id}#toolbar=0&navpanes=0&scrollbar=1`}
            title={name}
            onError={() => setError('This material could not be opened.')}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
          />
        )}

        {/* Blanks on capture or switching away */}
        {hidden && (
          <div style={{
            position: 'absolute', inset: 0, background: '#000',
            display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center',
          }}>
            <div>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
                <path d="M2 2l20 20" /><path d="M6.7 6.7A9.9 9.9 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 4.3-1" />
                <path d="M9.9 4.2A10.6 10.6 0 0 1 12 4c6.4 0 10 7 10 7a17 17 0 0 1-2.7 3.7" />
              </svg>
              <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 14, fontWeight: 600 }}>Hidden</p>
              <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 12.5, marginTop: 4 }}>
                Return to the portal to keep reading.
              </p>
            </div>
          </div>
        )}

        {/* Light watermark, so a photograph is traceable */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          display: 'grid', placeItems: 'center', opacity: 0.07,
        }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: '#000', transform: 'rotate(-28deg)' }}>
            Cambridge Center of Excellence
          </span>
        </div>
      </div>
    </div>
  )
}
