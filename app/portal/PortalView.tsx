'use client'
import { useEffect, useState } from 'react'
import MaterialViewer from './MaterialViewer'

const C = {
  ink: '#12222b', soft: '#5c6b74', faint: '#93a1a9', line: '#e6ebee',
  teal: '#1a7a85', tealDeep: '#125c66', tealSoft: '#eef6f7',
  ok: '#1f7a4d', warn: '#a35a08', warnSoft: '#fdf3e6',
  danger: '#a32020', dangerSoft: '#fbeceb', bg: '#f4f6f7',
}
const ghs = (n: number) => 'GHS ' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const Ico = {
  home: (a: boolean) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={a ? C.teal : C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>,
  klass: (a: boolean) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={a ? C.teal : C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="13" rx="2" /><path d="M9 21h6" /><path d="M12 18v3" /></svg>,
  book: (a: boolean) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={a ? C.teal : C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" /><path d="M8 3v18" /></svg>,
  wallet: (a: boolean) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={a ? C.teal : C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></svg>,
  lock: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  doc: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={C.teal} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>,
  down: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12" /><path d="m7 12 5 5 5-5" /><path d="M5 20h14" /></svg>,
  video: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3z" /></svg>,
}

const Card = ({ children, style }: any) => (
  <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, marginBottom: 14, ...style }}>{children}</div>
)
const Label = ({ children }: any) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 12 }}>{children}</div>
)
const Btn = ({ children, onClick, tone = 'teal', disabled }: any) => {
  const bg = tone === 'ok' ? C.ok : tone === 'ghost' ? '#fff' : C.teal
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', minHeight: 52, border: tone === 'ghost' ? `1px solid ${C.line}` : 'none',
      borderRadius: 13, fontSize: 15.5, fontWeight: 700, fontFamily: font,
      background: disabled ? '#c8d2d6' : bg, color: tone === 'ghost' ? C.ink : '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, cursor: 'pointer',
    }}>{children}</button>
  )
}

export default function PortalView({ demo, demoData }: { demo?: boolean; demoData?: any }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'home' | 'class' | 'materials' | 'fees'>('home')
  const [installEvt, setInstallEvt] = useState<any>(null)
  const [showIos, setShowIos] = useState(false)
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState('')
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null)

  async function load() {
    if (demo) { setD(demoData); setLoading(false); return }
    const r = await fetch('/api/student/me')
    if (r.status === 401) { window.location.href = '/portal/login'; return }
    setD(await r.json()); setLoading(false)
  }
  useEffect(() => { load() }, [demo, demoData])

  useEffect(() => {
    const h = (e: any) => { e.preventDefault(); setInstallEvt(e) }
    window.addEventListener('beforeinstallprompt', h)
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
    if (isIos && !standalone) setShowIos(true)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  async function pay() {
    if (demo) { alert('In the live portal this opens Paystack so the student can pay by mobile money or card.'); return }
    const amt = Number(amount)
    const min = Number(d?.session?.minTopUp || 0)
    if (!(amt > 0)) return alert('Enter an amount')
    if (min > 0 && amt + 0.01 < min) return alert(`You need to pay at least ${ghs(min)} to join the next class. You may pay more.`)
    setPaying(true)
    const init = await fetch('/api/student/pay-init', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amt }),
    }).then(r => r.json()).catch(() => null)
    setPaying(false)
    if (init?.authorization_url) window.location.href = init.authorization_url
    else alert(init?.error || 'Could not start payment. Please try again.')
  }

  const [joining, setJoining] = useState(false)
  async function joinClass() {
    if (demo) { alert('In the live portal this opens Zoom — the app launches on a phone, or the Zoom client on a laptop.'); return }
    setJoining(true)
    // Ask the server for a one-time entry link. The Zoom URL never reaches the
    // browser, so it cannot be copied and shared with someone who has not paid.
    const r = await fetch('/api/student/join', { method: 'POST' }).then(x => x.json()).catch(() => null)
    setJoining(false)
    if (r?.url) { window.location.href = r.url; setTimeout(load, 3000); return }
    if (r?.error === 'payment_required') { alert(`You need to pay at least ${ghs(r.minTopUp)} to join this session.`); setTab('fees'); load(); return }
    if (r?.error === 'cohort_ended') { alert('This class has ended. Please contact the administration.'); load(); return }
    alert('Could not open the class. Please try again.')
  }

  if (loading) return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: C.bg, fontFamily: font }}>
      <div style={{ width: 34, height: 34, border: `3px solid ${C.line}`, borderTopColor: C.teal, borderRadius: '50%', animation: 'sp .8s linear infinite' }} />
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const f = d?.fee, s = d?.session
  const first = (d?.student?.name || '').split(' ')[0]
  const pct = f?.total ? Math.min(100, (f.paid / f.total) * 100) : 0

  const TABS = [
    { k: 'home', label: 'Home', icon: Ico.home },
    { k: 'class', label: 'Class', icon: Ico.klass },
    { k: 'materials', label: 'Materials', icon: Ico.book },
    { k: 'fees', label: 'Fees', icon: Ico.wallet },
  ] as const

  const InstallBanner = () => (
    <>
      {installEvt && (
        <Card style={{ background: C.tealSoft, borderColor: '#cde3e6' }}>
          <div style={{ fontWeight: 700, color: C.ink, fontSize: 14.5 }}>Install your portal</div>
          <p style={{ fontSize: 13.5, color: C.soft, margin: '6px 0 13px', lineHeight: 1.55 }}>Add it to your home screen so it opens like an app.</p>
          <Btn onClick={async () => { installEvt.prompt(); setInstallEvt(null) }}>Install</Btn>
        </Card>
      )}
      {showIos && !installEvt && (
        <Card style={{ background: C.tealSoft, borderColor: '#cde3e6' }}>
          <div style={{ fontWeight: 700, color: C.ink, fontSize: 14.5 }}>Add to your home screen</div>
          <p style={{ fontSize: 13.5, color: C.soft, margin: '6px 0 0', lineHeight: 1.6 }}>
            In Safari, tap <b>Share</b> at the bottom of the screen, then choose <b>Add to Home Screen</b>.
          </p>
          <button onClick={() => setShowIos(false)} style={{ background: 'none', border: 'none', color: C.teal, fontSize: 13.5, fontWeight: 700, marginTop: 10, padding: 0, fontFamily: font }}>Got it</button>
        </Card>
      )}
    </>
  )

  const ClassStatus = () => {
    if (!d?.batch) return <p style={{ fontSize: 14, color: C.soft, lineHeight: 1.6 }}>Your class will appear here once you have been added to a group.</p>
    if (!s) return null
    if (s.cohortEnded) return (
      <div style={{ background: C.dangerSoft, border: '1px solid #f0cfcd', borderRadius: 13, padding: 15 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.danger }}>This class has ended</div>
        <p style={{ fontSize: 13.5, color: C.soft, margin: '7px 0 0', lineHeight: 1.6 }}>
          Your group finished{s.endDate ? ` on ${new Date(s.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}, so the class link is no longer available.
          To rejoin, please contact the administration to be placed in a new group.
        </p>
      </div>
    )
    if (s.canJoin) return (
      <>
        <Btn tone="ok" onClick={joinClass} disabled={joining}>{Ico.video} {joining ? 'Opening' : 'Join class'}</Btn>
        <p style={{ fontSize: 12.5, color: C.faint, textAlign: 'center', margin: '10px 0 0' }}>Opens Zoom on your phone or laptop.</p>
      </>
    )
    return (
      <div style={{ background: C.warnSoft, border: '1px solid #f2ddc0', borderRadius: 13, padding: 15 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.warn }}>Payment required to join</div>
        <p style={{ fontSize: 13.5, color: C.soft, margin: '7px 0 13px', lineHeight: 1.6 }}>
          Pay at least <b style={{ color: C.ink }}>{ghs(s.minTopUp)}</b> to unlock session {s.sessionNumber}. You may pay more.
        </p>
        <Btn onClick={() => setTab('fees')}>Make payment</Btn>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: font, paddingBottom: 86 }}>
      <div style={{ background: `linear-gradient(160deg, ${C.teal}, ${C.tealDeep})`, padding: '20px 20px 24px', color: '#fff' }}>
        <div style={{ fontSize: 11.5, opacity: 0.82, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Cambridge Center of Excellence</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 5, letterSpacing: '-0.01em' }}>
          {tab === 'home' ? `Hello, ${first}` : tab === 'class' ? 'Your class' : tab === 'materials' ? 'Course materials' : 'Your fees'}
        </div>
        {d?.course && <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>{d.course}</div>}
      </div>

      <div style={{ padding: 16, maxWidth: 560, margin: '0 auto' }}>
        {tab === 'home' && (
          <>
            <InstallBanner />
            <Card>
              <Label>Next class</Label>
              {d?.batch ? (
                <>
                  <div style={{ fontSize: 17.5, fontWeight: 700, color: C.ink }}>{d.batch.name}</div>
                  {d.batch.schedule && <div style={{ fontSize: 13.5, color: C.soft, marginTop: 4 }}>{d.batch.schedule}</div>}
                  {s && !s.cohortEnded && (
                    <div style={{ fontSize: 13, color: C.faint, marginTop: 8 }}>
                      Session {s.sessionNumber}{s.signedInToday ? ' · you signed in today' : ''}
                    </div>
                  )}
                  <div style={{ marginTop: 15 }}><ClassStatus /></div>
                </>
              ) : <ClassStatus />}
            </Card>

            {f && (
              <Card>
                <Label>Fees</Label>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13.5, color: C.soft }}>Balance</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: f.balance > 0 ? C.warn : C.ok, letterSpacing: '-0.01em' }}>{ghs(f.balance)}</span>
                </div>
                <div style={{ height: 8, background: '#eaeef0', borderRadius: 99, marginTop: 13, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: C.teal, borderRadius: 99 }} />
                </div>
                <div style={{ fontSize: 12.5, color: C.faint, marginTop: 8 }}>{ghs(f.paid)} paid of {ghs(f.total)}</div>
                {f.balance > 0 && <div style={{ marginTop: 15 }}><Btn onClick={() => setTab('fees')}>Make payment</Btn></div>}
              </Card>
            )}

            {/* Always shown, so a student knows the certificate is coming and
                 what still stands between them and it. */}
            {!d?.certificate && d?.certificateState && d.certificateState !== 'unknown' && (
              <Card>
                <Label>Your certificate</Label>
                <p style={{ fontSize: 14, color: C.soft, lineHeight: 1.6 }}>
                  {d.certificateState === 'fees_outstanding'
                    ? 'Your certificate unlocks here once your fees are fully paid and your class is near its end.'
                    : 'Your fees are cleared. Your certificate appears here in the final sessions of your class.'}
                </p>
                {d.certificateState === 'fees_outstanding' && f?.balance > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <Btn tone="ghost" onClick={() => setTab('fees')}>See what is left to pay</Btn>
                  </div>
                )}
              </Card>
            )}

            {d?.certificate && (
              <Card style={{ borderColor: '#cde3e6', background: C.tealSoft }}>
                <Label>Your certificate</Label>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{d.certificate.course_name}</div>
                <div style={{ fontSize: 12.5, color: C.soft, marginTop: 3 }}>
                  {d.certificate.certificate_number}
                  {d.certificate.issued_date ? ` · issued ${new Date(d.certificate.issued_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
                </div>
                <div style={{ marginTop: 14 }}>
                  <a href={d.certificate.final_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                    <Btn>Download certificate</Btn>
                  </a>
                </div>
              </Card>
            )}

            <Card>
              <Label>Course materials</Label>
              <div style={{ fontSize: 14, color: C.soft }}>
                {d?.materials?.unlocked?.length
                  ? `${d.materials.unlocked.length} available to download`
                  : 'Your materials are released as you make payments.'}
              </div>
              <div style={{ marginTop: 14 }}><Btn tone="ghost" onClick={() => setTab('materials')}>View materials</Btn></div>
            </Card>
          </>
        )}

        {tab === 'class' && (
          <>
            <Card>
              <Label>Your group</Label>
              {d?.batch ? (
                <>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{d.batch.name}</div>
                  {d.batch.schedule && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 14 }}>
                      <span style={{ color: C.soft }}>Schedule</span><b style={{ color: C.ink }}>{d.batch.schedule}</b>
                    </div>
                  )}
                  {d.batch.startDate && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, fontSize: 14 }}>
                      <span style={{ color: C.soft }}>Started</span>
                      <b style={{ color: C.ink }}>{new Date(d.batch.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b>
                    </div>
                  )}
                  {s && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, fontSize: 14 }}>
                      <span style={{ color: C.soft }}>Session</span><b style={{ color: C.ink }}>{s.sessionNumber}</b>
                    </div>
                  )}
                </>
              ) : <p style={{ fontSize: 14, color: C.soft }}>You have not been added to a class group yet.</p>}
            </Card>
            <Card><Label>Join</Label><ClassStatus /></Card>
          </>
        )}

        {tab === 'materials' && (
          <>
            <Card>
              <Label>Available now</Label>
              {d?.materials?.unlocked?.length ? d.materials.unlocked.map((m: any, i: number) => (
                <button key={i} onClick={() => m.id && setViewing({ id: m.id, name: m.name })}
                  style={{ width: '100%', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: i ? `1px solid ${C.line}` : 'none', textAlign: 'left', cursor: 'pointer' }}>
                  {Ico.doc}
                  <span style={{ flex: 1, fontSize: 14.5, color: C.ink, fontWeight: 500 }}>{m.name}</span>
                  <span style={{ fontSize: 12, color: C.teal, fontWeight: 700, flexShrink: 0 }}>Open</span>
                </button>
              )) : (
                <p style={{ fontSize: 14, color: C.soft, lineHeight: 1.6 }}>
                  You do not have any materials yet. They are released as you make your payments.
                </p>
              )}
            </Card>
            {d?.materials?.locked?.length > 0 && (
              <Card>
                <Label>Released later</Label>
                {d.materials.locked.map((m: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                    {Ico.lock}
                    <span style={{ flex: 1, fontSize: 14.5, color: C.faint }}>{m.name}</span>
                  </div>
                ))}
                <p style={{ fontSize: 12.5, color: C.faint, margin: '12px 0 0', lineHeight: 1.55 }}>
                  These become available as your payments continue.
                </p>
              </Card>
            )}
          </>
        )}

        {tab === 'fees' && (
          <>
            {f ? (
              <>
                <Card>
                  <Label>Summary</Label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
                    <span style={{ color: C.soft }}>Course fee</span><b style={{ color: C.ink }}>{ghs(f.total)}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 14.5 }}>
                    <span style={{ color: C.soft }}>Paid</span><b style={{ color: C.ok }}>{ghs(f.paid)}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 13, borderTop: `1px solid ${C.line}`, fontSize: 15 }}>
                    <span style={{ color: C.ink, fontWeight: 600 }}>Balance</span>
                    <b style={{ color: f.balance > 0 ? C.warn : C.ok, fontSize: 17 }}>{ghs(f.balance)}</b>
                  </div>
                  <div style={{ height: 8, background: '#eaeef0', borderRadius: 99, marginTop: 14, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: C.teal, borderRadius: 99 }} />
                  </div>
                </Card>

                {f.balance > 0 && (
                  <Card>
                    <Label>Make a payment</Label>
                    {s?.minTopUp > 0 && (
                      <div style={{ background: C.warnSoft, border: '1px solid #f2ddc0', borderRadius: 11, padding: 13, marginBottom: 14 }}>
                        <p style={{ fontSize: 13.5, color: C.soft, margin: 0, lineHeight: 1.6 }}>
                          To join session {s.sessionNumber} you need to pay at least <b style={{ color: C.ink }}>{ghs(s.minTopUp)}</b>.
                        </p>
                      </div>
                    )}
                    <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal"
                      placeholder={s?.minTopUp ? `Minimum ${ghs(s.minTopUp)}` : 'Enter amount'}
                      style={{ width: '100%', height: 52, padding: '0 15px', borderRadius: 13, border: `1px solid ${C.line}`, fontSize: 16, boxSizing: 'border-box', fontFamily: font, color: C.ink }} />
                    <div style={{ marginTop: 12 }}>
                      <Btn onClick={pay} disabled={paying}>{paying ? 'Opening payment' : 'Pay now'}</Btn>
                    </div>
                    <p style={{ fontSize: 12.5, color: C.faint, textAlign: 'center', margin: '11px 0 0' }}>Mobile money or card</p>
                  </Card>
                )}
              </>
            ) : <Card><p style={{ fontSize: 14, color: C.soft }}>No fee record found yet.</p></Card>}

            {d?.payments?.length > 0 && (
              <Card>
                <Label>Payment history</Label>
                {d.payments.map((p: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{ghs(p.amount)}</div>
                      <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{p.receipt_number || p.method}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.faint }}>
                      {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}
      </div>

      {viewing && (
        <MaterialViewer id={viewing.id} name={viewing.name} onClose={() => setViewing(null)} />
      )}

      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff',
        borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-around',
        padding: '9px 0 max(9px, env(safe-area-inset-bottom))', zIndex: 50,
      }}>
        {TABS.map(t => {
          const active = tab === t.k
          return (
            <button key={t.k} onClick={() => setTab(t.k as any)} style={{
              background: 'none', border: 'none', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 4, padding: '3px 14px', cursor: 'pointer', fontFamily: font,
            }}>
              {t.icon(active)}
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? C.teal : C.faint }}>{t.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
