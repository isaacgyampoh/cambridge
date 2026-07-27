'use client'
import { useState } from 'react'

export default function StudentLogin() {
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
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#fafbfc', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src="/brand/logo.png" alt="" style={{ width: 56, height: 56, objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#1a2230' }}>Student Portal</h1>
          <p style={{ fontSize: 14, color: '#5a6675', marginTop: 4 }}>Cambridge Center of Excellence</p>
        </div>
        {sent ? (
          <div style={{ background: '#fff', border: '1px solid #eaedf1', borderRadius: 14, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>📲</div>
            <p style={{ fontSize: 15, color: '#1a2230', lineHeight: 1.6 }}>
              If that number is registered with us, we've sent your portal link on WhatsApp. Tap it to sign in.
            </p>
            <button onClick={() => setSent(false)} style={{ marginTop: 16, background: 'none', border: 'none', color: '#1a7a85', fontSize: 14, fontWeight: 600 }}>Use a different number</button>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #eaedf1', borderRadius: 14, padding: 22 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#5a6675', marginBottom: 7 }}>Your phone number</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 123 4567" inputMode="tel"
              style={{ width: '100%', height: 46, padding: '0 14px', borderRadius: 10, border: '1px solid #eaedf1', fontSize: 16, boxSizing: 'border-box' }} />
            <button onClick={send} disabled={busy}
              style={{ width: '100%', height: 46, marginTop: 14, background: '#1a7a85', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600 }}>
              {busy ? 'Sending…' : 'Send my link'}
            </button>
            <p style={{ fontSize: 12, color: '#97a1b0', marginTop: 12, lineHeight: 1.5, textAlign: 'center' }}>
              We'll WhatsApp you a link. No password needed.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
