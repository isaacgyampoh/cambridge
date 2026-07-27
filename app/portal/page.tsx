'use client'
import { useEffect, useState } from 'react'

const T = { ink: '#1a2230', soft: '#5a6675', faint: '#97a1b0', line: '#eaedf1', teal: '#1a7a85', tealSoft: '#eef6f7', ok: '#2f9e57', warn: '#d97706' }
const card: React.CSSProperties = { background: '#fff', border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, marginBottom: 14 }
const btn: React.CSSProperties = { width: '100%', height: 48, border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }
const ghs = (n: number) => `GHS ${Number(n || 0).toFixed(2)}`

export default function StudentPortal() {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [installEvt, setInstallEvt] = useState<any>(null)
  const [showIos, setShowIos] = useState(false)
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState('')

  async function load() {
    const r = await fetch('/api/student/me')
    if (r.status === 401) { window.location.href = '/portal/login'; return }
    setD(await r.json()); setLoading(false)
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const h = (e: any) => { e.preventDefault(); setInstallEvt(e) }
    window.addEventListener('beforeinstallprompt', h)
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
    if (isIos && !standalone) setShowIos(true)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  async function pay() {
    const amt = Number(amount)
    const min = Number(d?.session?.minTopUp || 0)
    if (!(amt > 0)) return alert('Enter an amount')
    if (min > 0 && amt + 0.01 < min) return alert(`You need to pay at least ${ghs(min)} to join the next class. You can pay more.`)
    setPaying(true)
    const init = await fetch('/api/student/pay-init', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt }),
    }).then(r => r.json()).catch(() => null)
    setPaying(false)
    if (init?.authorization_url) window.location.href = init.authorization_url
    else alert(init?.error || 'Could not start payment. Please try again.')
  }

  async function joinClass() {
    if (!d?.session?.canJoin) return
    if (d.session.zoomLink) {
      fetch('/api/student/signin', { method: 'POST' }).catch(() => {})
      window.open(d.session.zoomLink, '_blank')
      setTimeout(load, 1500)
    }
  }

  if (loading) return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#fafbfc' }}><div style={{ color: T.soft }}>Loading…</div></div>

  const f = d?.fee, s = d?.session

  return (
    <div style={{ minHeight: '100dvh', background: '#fafbfc', fontFamily: 'Inter, system-ui, sans-serif', paddingBottom: 40 }}>
      <div style={{ background: T.teal, padding: '22px 20px 26px', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>Cambridge Center of Excellence</div>
        <div style={{ fontSize: 21, fontWeight: 700, marginTop: 2 }}>Hi {(d?.student?.name || '').split(' ')[0]} 👋</div>
        {d?.course && <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>{d.course}</div>}
      </div>

      <div style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
        {installEvt && (
          <div style={{ ...card, background: T.tealSoft, borderColor: '#cfe6e9' }}>
            <div style={{ fontWeight: 700, color: T.ink, fontSize: 14 }}>Install your portal</div>
            <p style={{ fontSize: 13, color: T.soft, margin: '5px 0 12px' }}>Add it to your home screen so it opens like an app.</p>
            <button onClick={async () => { installEvt.prompt(); setInstallEvt(null) }} style={{ ...btn, height: 42, background: T.teal, color: '#fff' }}>Install</button>
          </div>
        )}
        {showIos && !installEvt && (
          <div style={{ ...card, background: T.tealSoft, borderColor: '#cfe6e9' }}>
            <div style={{ fontWeight: 700, color: T.ink, fontSize: 14 }}>Add to your home screen</div>
            <p style={{ fontSize: 13, color: T.soft, margin: '6px 0 0', lineHeight: 1.6 }}>
              In Safari, tap <b>Share</b> <span style={{ fontSize: 15 }}>􀈂</span> at the bottom, then choose <b>Add to Home Screen</b>.
            </p>
            <button onClick={() => setShowIos(false)} style={{ background: 'none', border: 'none', color: T.teal, fontSize: 13, fontWeight: 600, marginTop: 8, padding: 0 }}>Got it</button>
          </div>
        )}

        {/* CLASS */}
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.faint, letterSpacing: '0.06em' }}>YOUR CLASS</div>
          {d?.batch ? (
            <>
              <div style={{ fontSize: 17, fontWeight: 700, color: T.ink, marginTop: 6 }}>{d.batch.name}</div>
              {d.batch.schedule && <div style={{ fontSize: 13, color: T.soft, marginTop: 3 }}>{d.batch.schedule}</div>}
              {s && (
                <>
                  <div style={{ fontSize: 13, color: T.soft, marginTop: 10 }}>
                    Session {s.sessionNumber}{s.signedInToday ? ' · signed in today ✓' : ''}
                  </div>
                  {s.cohortEnded ? (
                    <div style={{ marginTop: 12, background: '#fdecec', border: '1px solid #f5c6c6', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#c0392b' }}>This class has ended</div>
                      <p style={{ fontSize: 13, color: T.soft, margin: '6px 0 0', lineHeight: 1.6 }}>
                        Your cohort finished{s.endDate ? ` on ${new Date(s.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}, so the class link is no longer available.
                        If you'd like to rejoin, please contact administration to be added to a new cohort.
                      </p>
                    </div>
                  ) : s.canJoin ? (
                    <button onClick={joinClass} style={{ ...btn, background: T.ok, color: '#fff', marginTop: 12 }}>
                      Join class
                    </button>
                  ) : (
                    <div style={{ marginTop: 12, background: '#fdf4e7', border: '1px solid #f4ddb8', borderRadius: 10, padding: 13 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.warn }}>Payment needed to join</div>
                      <p style={{ fontSize: 13, color: T.soft, margin: '5px 0 0', lineHeight: 1.55 }}>
                        Pay at least <b>{ghs(s.minTopUp)}</b> to unlock session {s.sessionNumber}. You can pay more if you wish.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          ) : <p style={{ fontSize: 14, color: T.soft, marginTop: 8 }}>You'll see your class here once you've been added to a batch.</p>}
        </div>

        {/* FEES */}
        {f && (
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.faint, letterSpacing: '0.06em' }}>YOUR FEES</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 14 }}>
              <span style={{ color: T.soft }}>Total</span><b style={{ color: T.ink }}>{ghs(f.total)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 14 }}>
              <span style={{ color: T.soft }}>Paid</span><b style={{ color: T.ok }}>{ghs(f.paid)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 14 }}>
              <span style={{ color: T.soft }}>Balance</span><b style={{ color: f.balance > 0 ? T.warn : T.ok }}>{ghs(f.balance)}</b>
            </div>
            <div style={{ height: 7, background: '#eef1f4', borderRadius: 99, marginTop: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${f.total ? Math.min(100, (f.paid / f.total) * 100) : 0}%`, background: T.teal }} />
            </div>
            {f.balance > 0 && (
              <div style={{ marginTop: 14 }}>
                <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal"
                  placeholder={s?.minTopUp ? `Minimum ${ghs(s.minTopUp)}` : 'Amount to pay'}
                  style={{ width: '100%', height: 46, padding: '0 14px', borderRadius: 10, border: `1px solid ${T.line}`, fontSize: 16, boxSizing: 'border-box' }} />
                <button onClick={pay} disabled={paying} style={{ ...btn, background: T.teal, color: '#fff', marginTop: 10 }}>
                  {paying ? 'Opening payment…' : 'Pay now'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* MATERIALS */}
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.faint, letterSpacing: '0.06em' }}>COURSE MATERIALS</div>
          {d?.materials?.unlocked?.length > 0 ? d.materials.unlocked.map((m: any, i: number) => (
            <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '11px 0', borderTop: i ? `1px solid ${T.line}` : 'none', color: T.ink, textDecoration: 'none', fontSize: 14 }}>
              📄 {m.name}
            </a>
          )) : <p style={{ fontSize: 14, color: T.soft, marginTop: 8 }}>Your materials appear here as you make payments.</p>}

          {d?.materials?.locked?.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
              {d.materials.locked.map((m: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 13, color: T.faint }}>
                  <span>🔒 {m.name}</span>
                  <span style={{ flexShrink: 0, marginLeft: 10 }}>at {ghs(m.unlockAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PAYMENT HISTORY */}
        {d?.payments?.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.faint, letterSpacing: '0.06em' }}>PAYMENT HISTORY</div>
            {d.payments.map((p: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: i ? `1px solid ${T.line}` : 'none', fontSize: 13 }}>
                <div>
                  <div style={{ color: T.ink, fontWeight: 600 }}>{ghs(p.amount)}</div>
                  <div style={{ color: T.faint, fontSize: 12 }}>{p.receipt_number || p.method}</div>
                </div>
                <div style={{ color: T.faint, fontSize: 12 }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
