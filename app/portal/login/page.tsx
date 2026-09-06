'use client'
import { useState, useEffect } from 'react'
import { Smartphone } from 'lucide-react'

export default function StudentLogin() {
  // Never scroll on a sign-in screen
  useEffect(() => {
    document.documentElement.classList.add('app-shell')
    return () => document.documentElement.classList.remove('app-shell')
  }, [])

  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!phone.trim()) return
    setBusy(true)
    await fetch('/api/student/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.trim() }),
    }).catch(() => {})
    setBusy(false); setSent(true)
  }

  return (
    <div style={{
      position: 'relative', height: '100dvh', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 'calc(46vh - 47px)', paddingInline: 24,
      background: '#fff', fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Brand canvas: teal field, arcs radiating from the badge, white sheet */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', userSelect: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', insetInline: 0, top: 0, height: '46%',
          background: 'var(--accent)' }} />
        <div style={{ position: 'absolute', insetInline: 0, top: 0, height: '46%',
          background: 'transparent' }} />
        {[168, 250, 340, 440].map((d, i) => (
          <div key={d} style={{
            position: 'absolute', width: d, height: d, left: '50%', top: '46%',
            transform: 'translate(-50%,-50%)', borderRadius: '50%',
            border: `1px solid rgba(255,255,255,${0.16 - i * 0.033})`,
          }} />
        ))}
        <div style={{ position: 'absolute', insetInline: 0, bottom: 0, top: '46%', background: '#fff',
          borderTopLeftRadius: 30, borderTopRightRadius: 30, boxShadow: '0 -14px 34px -16px rgba(7,42,47,.32)' }} />
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 94, height: 94, borderRadius: '50%', background: '#fff', padding: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
            boxShadow: '0 14px 34px -12px rgba(9,52,58,.45), 0 0 0 1px rgba(9,52,58,.06)',
          }}>
            <img src="/brand/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>Student Portal</h1>
          <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginTop: 4 }}>Cambridge Center of Excellence</p>
        </div>
        {sent ? (
          <div style={{ background: '#fff', border: '1px solid #eaedf1', borderRadius: 14, padding: 24, textAlign: 'center' }}>
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-soft)] grid place-items-center mx-auto mb-3">
              <Smartphone size={22} className="text-[var(--accent)]" aria-hidden="true" />
            </div>
            <p style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.6 }}>
              If that number is registered with us, we’ve sent your portal link on WhatsApp. Tap it to sign in.
            </p>
            <button onClick={() => setSent(false)} style={{ marginTop: 16, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>Use a different number</button>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #eaedf1', borderRadius: 14, padding: 22 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink-soft)', marginBottom: 7 }}>Your phone number</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 123 4567" inputMode="tel"
              style={{ width: '100%', height: 46, padding: '0 14px', borderRadius: 10, border: '1px solid #eaedf1', fontSize: 16, boxSizing: 'border-box' }} />
            <button onClick={send} disabled={busy}
              style={{ width: '100%', height: 46, marginTop: 14, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600 }}>
              {busy ? 'Sending…' : 'Send my link'}
            </button>
            <p style={{ fontSize: 12, color: '#97a1b0', marginTop: 12, lineHeight: 1.5, textAlign: 'center' }}>
              We’ll WhatsApp you a link. No password needed.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
