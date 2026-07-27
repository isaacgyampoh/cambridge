'use client'
import { uploadFile } from '@/lib/upload'
import { useState, useEffect, use } from 'react'
import Script from 'next/script'
import { CONFIG } from '@/lib/config'

type Step = 'locating' | 'name' | 'offer_online' | 'signed' | 'pay_amount' | 'pay_method' | 'bank' | 'done'

export default function ClassSignIn({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = use(params)
  const [step, setStep] = useState<Step>('locating')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [geoError, setGeoError] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)       // sign-in result
  const [payAmount, setPayAmount] = useState('')
  const [screenshot, setScreenshot] = useState('')
  const [uploading, setUploading] = useState(false)
  const [invoice, setInvoice] = useState<any>(null)

  // Get the student's location on load
  useEffect(() => {
    if (!navigator.geolocation) { setGeoError(true); setStep('name'); return }
    navigator.geolocation.getCurrentPosition(
      pos => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setStep('name') },
      () => { setGeoError(true); setStep('name') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  async function signIn(joiningOnline = false) {
    if (!name.trim()) { setError('Please type your name'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/classes/signin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, name, lat: coords?.lat, lng: coords?.lng, joiningOnline }),
      }).then(r => r.json())

      if (res.error === 'not_in_class') { setStep('offer_online'); setBusy(false); return }
      if (res.error === 'payment_required') {
        // Access denied until they top up — take them straight to payment with
        // the minimum pre-filled (they may pay more, never less).
        setResult(res)
        setPayAmount(String(res.minTopUp ?? ''))
        setError(res.message || 'A payment is required before you can join.')
        setStep('pay_amount')
        setBusy(false)
        return
      }
      if (res.error) { setError(res.message || res.error); setBusy(false); return }

      setResult(res)
      setStep('signed')
    } catch { setError('Something went wrong. Please try again.') }
    finally { setBusy(false) }
  }

  // ── MoMo via Paystack ──
  async function payMomo() {
    const amt = Number(payAmount)
    if (!(amt > 0)) { setError('Enter an amount'); return }
    const minRequired = Number(result?.minTopUp || 0)
    if (minRequired > 0 && amt + 0.01 < minRequired) {
      setError(`Access denied — you must pay at least GHS ${minRequired.toFixed(2)} to join this session. You can pay more if you wish.`)
      return
    }
    const ps = (window as any).PaystackPop
    if (!ps) { setError('Payment not available. Please refresh.'); return }
    const keyRes = await fetch('/api/paystack/key').then(r => r.json()).catch(() => null)
    const payKey = keyRes?.key
    if (!payKey) { setError('Payment is not configured.'); return }
    ps.setup({
      key: payKey,
      email: `${result.studentName?.replace(/\s+/g, '').toLowerCase() || 'student'}@cce.edu.gh`,
      amount: Math.round(amt * 100),
      currency: 'GHS',
      ref: `CCE-CLS-${result.enrollmentId}-${Date.now()}`,
      channels: ['mobile_money', 'card'],
      callback: (res: any) => { recordPayment('momo', amt, res.reference) },
      onClose: () => {},
    }).openIframe()
  }

  async function recordPayment(method: string, amount: number, paystackRef?: string, screenshotUrl?: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/classes/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: result.enrollmentId, amount, method, paystackRef, screenshotUrl }),
      }).then(r => r.json())
      if (res.error) { setError(res.error); setBusy(false); return }
      setInvoice(res)
      setStep('done')
    } catch { setError('Could not record payment') }
    finally { setBusy(false) }
  }

  async function uploadShot(file: File) {
    setUploading(true)
    try {
      const r = await uploadFile(file, 'bank-proofs')
      if (r.url) setScreenshot(r.url)
    } catch { setError('Upload failed') }
    finally { setUploading(false) }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#f5f8fc', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px' }
  const card: React.CSSProperties = { maxWidth: 440, width: '100%', background: '#fff', borderRadius: 18, border: '1px solid #e6eaf0', padding: 26 }
  const btn: React.CSSProperties = { width: '100%', height: 48, borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer' }
  const inp: React.CSSProperties = { width: '100%', height: 48, padding: '0 14px', borderRadius: 12, border: '1px solid #e6eaf0', fontSize: 15, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={wrap}>
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img src="/brand/logo.png" alt="Cambridge Center of Excellence" style={{ width: 56, height: 56, objectFit: 'contain', margin: '0 auto 10px' }} />
          <div style={{ fontSize: 13, color: '#94a3b8' }}>Cambridge Center of Excellence</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#1a2230', margin: '4px 0 0' }}>Class sign-in</h1>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#dc2626', fontSize: 13, padding: '10px 12px', borderRadius: 10, marginBottom: 14 }}>{error}</div>}

        {step === 'locating' && (
          <p style={{ textAlign: 'center', color: '#4a5568', fontSize: 14 }}>Checking your location…</p>
        )}

        {step === 'name' && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type your name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" style={{ ...inp, margin: '8px 0 16px' }} />
            <button onClick={() => signIn(false)} disabled={busy} style={{ ...btn, background: 'var(--accent)', color: '#fff', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {geoError && <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, textAlign: 'center' }}>Location is off. If you're in class, please enable location so we can sign you in.</p>}
          </>
        )}

        {step === 'offer_online' && (
          <>
            <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 16, textAlign: 'center' }}>You don't appear to be at the class venue. Are you joining online today?</p>
            <button onClick={() => signIn(true)} disabled={busy} style={{ ...btn, background: 'var(--accent)', color: '#fff', marginBottom: 10, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Switching…' : 'Yes, I\'m joining online'}
            </button>
            <button onClick={() => { setStep('name'); setError('') }} style={{ ...btn, background: '#f1f5f9', color: '#4a5568' }}>Back</button>
          </>
        )}

        {step === 'signed' && result && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 15, color: '#1a2230', fontWeight: 600 }}>You're signed in, {result.studentName?.split(' ')[0]}!</div>
              <div style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999, background: result.mode === 'online' ? '#eef2ff' : '#ecfdf5', color: result.mode === 'online' ? '#4338ca' : '#059669' }}>
                {result.mode === 'online' ? (result.switched ? 'Switched to online' : 'Online') : 'In person'}
              </div>
            </div>

            {result.mode === 'online' && (
              result.zoomLink ? (
                <a href={result.zoomLink} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: '#2D8CFF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', marginBottom: 16 }}>
                  Join the Zoom class
                </a>
              ) : (
                <p style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 16 }}>The Zoom link will be shared by your coordinator.</p>
              )
            )}

            {result.balance > 0 ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <div style={{ fontSize: 13, color: '#92400e' }}>Outstanding fees</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#92400e' }}>GHS {result.balance.toFixed(2)}</div>
                <button onClick={() => { setPayAmount(String(result.balance)); setStep('pay_amount') }} style={{ ...btn, height: 44, background: '#d4a23a', color: '#fff', marginTop: 12 }}>Pay now</button>
              </div>
            ) : (
              <p style={{ textAlign: 'center', color: '#059669', fontSize: 14, fontWeight: 500 }}>Your fees are fully paid. Enjoy your class!</p>
            )}
            {Array.isArray(result?.materials) && result.materials.length > 0 && (
              <div style={{ marginTop: 18, marginBottom: 16, textAlign: 'left', background: '#f0f7f8', borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a7a85', marginBottom: 8 }}>Your course materials</div>
                {result.materials.map((m: any, i: number) => (
                  <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', fontSize: 13, color: '#1a2230', textDecoration: 'none', padding: '7px 0', borderTop: i ? '1px solid #dbe9eb' : 'none' }}>
                    📄 {m.name}
                  </a>
                ))}
                <div style={{ fontSize: 11, color: '#5a6675', marginTop: 8 }}>More materials unlock as you continue your payments.</div>
              </div>
            )}
            <button onClick={() => setStep('done')} style={{ ...btn, background: '#f1f5f9', color: '#4a5568' }}>Done</button>
          </>
        )}

        {step === 'pay_amount' && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>How much are you paying?</label>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 8px' }}>You can pay all or part of your GHS {result.balance.toFixed(2)} balance.</p>
            <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} style={{ ...inp, marginBottom: 16 }} />
            <button onClick={() => { if (Number(payAmount) > 0) { setError(''); setStep('pay_method') } else setError('Enter an amount') }} style={{ ...btn, background: 'var(--accent)', color: '#fff' }}>Continue</button>
          </>
        )}

        {step === 'pay_method' && (
          <>
            <p style={{ fontSize: 14, color: '#4a5568', marginBottom: 14, textAlign: 'center' }}>Paying GHS {Number(payAmount).toFixed(2)} — choose a method</p>
            <button onClick={payMomo} disabled={busy} style={{ ...btn, background: '#ffcc00', color: '#1a2230', marginBottom: 10 }}>Mobile Money (MoMo)</button>
            <button onClick={() => setStep('bank')} style={{ ...btn, background: '#1e3a8a', color: '#fff', marginBottom: 10 }}>Bank transfer</button>
            {result.allowCash && (
              <button onClick={() => recordPayment('cash', Number(payAmount))} disabled={busy} style={{ ...btn, background: '#f1f5f9', color: '#4a5568' }}>Cash (pay at the desk)</button>
            )}
            {!result.allowCash && <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>Online students pay by MoMo or bank only.</p>}
          </>
        )}

        {step === 'bank' && (
          <>
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, marginBottom: 14, fontSize: 14, color: '#1a2230' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Bank transfer details</div>
              <div>Bank: <strong>{CONFIG.bankName}</strong></div>
              <div>Account name: <strong>{CONFIG.bankAccountName}</strong></div>
              <div>Account: <strong>{CONFIG.bankAccountNumber}</strong></div>
              {CONFIG.bankBranch && <div>Branch: <strong>{CONFIG.bankBranch}</strong></div>}
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Transfer GHS {Number(payAmount).toFixed(2)}, then upload your screenshot below. The accountant will verify it.</div>
            </div>
            {screenshot ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <img src={screenshot} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} />
                <span style={{ fontSize: 13, color: '#059669' }}>Screenshot attached</span>
              </div>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 12, border: '1px dashed #cbd5e1', fontSize: 14, color: '#4a5568', cursor: 'pointer', marginBottom: 12 }}>
                {uploading ? 'Uploading…' : 'Upload payment screenshot'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadShot(f) }} />
              </label>
            )}
            <button onClick={() => recordPayment('bank', Number(payAmount), undefined, screenshot)} disabled={busy || !screenshot} style={{ ...btn, background: 'var(--accent)', color: '#fff', opacity: (busy || !screenshot) ? 0.5 : 1 }}>
              {busy ? 'Submitting…' : 'Submit for verification'}
            </button>
          </>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            {invoice ? (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a2230', margin: '0 0 6px' }}>{invoice.verified ? 'Payment received' : invoice.message}</h2>
                <p style={{ fontSize: 13, color: '#4a5568' }}>Invoice: {invoice.invoiceNo}</p>
                {invoice.verified && <p style={{ fontSize: 14, color: '#4a5568', marginTop: 6 }}>{invoice.balance > 0 ? `Balance remaining: GHS ${invoice.balance.toFixed(2)}` : 'Your fees are fully paid.'}</p>}
                {!invoice.verified && <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>You'll get a confirmation once it's verified.</p>}
              </>
            ) : (
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a2230' }}>You're signed in. Enjoy your class!</h2>
            )}
            {result?.mode === 'online' && result?.zoomLink && (
              <a href={result.zoomLink} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: '#2D8CFF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', marginTop: 16 }}>Join the Zoom class</a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
