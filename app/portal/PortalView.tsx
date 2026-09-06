'use client'
import { useEffect, useState, useCallback, useSyncExternalStore } from 'react'
import MaterialViewer from './MaterialViewer'

/**
 * The student portal.
 *
 * Built mobile-first: a thumb-reachable tab bar at the bottom on a phone, the
 * same information architecture as a side rail from `lg` up. It is not a
 * desktop layout that has been squeezed.
 *
 * Colours come from the shared design tokens in app/globals.css rather than
 * the local constants this file used to carry, so the portal and the staff ERP
 * stay one system. Everything here is Tailwind against those variables.
 */

const ghs = (n: number) =>
  'GHS ' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const longDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

type Tab = 'home' | 'class' | 'materials' | 'payments' | 'profile'

type Material = { id?: string; name: string; section?: number | null; unlockAt?: number }
type PortalData = {
  student?: { name?: string; phone?: string; classMode?: string | null; classModeLabel?: string | null; admissionNumber?: string | null; admissionStatus?: string | null }
  course?: string | null
  fee?: { total: number; paid: number; balance: number; status?: string } | null
  batch?: { id: string; name: string; schedule?: string; startDate?: string; type?: string } | null
  session?: {
    canJoin?: boolean; cohortEnded?: boolean; minTopUp?: number; sessionNumber?: number
    sectionNo?: number | null; sectionTitle?: string | null; signedInToday?: boolean; endDate?: string
  } | null
  materials?: { unlocked: Material[]; locked: Material[] }
  admission?: { number: string | null; status: string | null; letterUrl: string | null } | null
  certificate?: { certificate_number?: string; final_url?: string; issued_date?: string; course_name?: string } | null
  certificateState?: string
  payments?: Array<{ amount: number; method?: string; receipt_number?: string; created_at: string }>
}

// ── Icons: 24px stroke set, sized for a 44px touch target ────────────────────
const icon = (path: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
)
const Icons = {
  home: icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  klass: icon(<><rect x="2.5" y="5" width="19" height="13" rx="2" /><path d="M9 21h6" /><path d="M12 18v3" /></>),
  book: icon(<><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" /><path d="M8 3v18" /></>),
  wallet: icon(<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></>),
  user: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>),
  lock: icon(<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
  doc: icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>),
  video: icon(<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3z" /></>),
  award: icon(<><circle cx="12" cy="9" r="6" /><path d="m8.5 14-1.5 7 5-3 5 3-1.5-7" /></>),
}

const TABS: Array<{ k: Tab; label: string; icon: React.ReactNode }> = [
  { k: 'home', label: 'Home', icon: Icons.home },
  { k: 'class', label: 'Class', icon: Icons.klass },
  { k: 'materials', label: 'Materials', icon: Icons.book },
  { k: 'payments', label: 'Payments', icon: Icons.wallet },
  { k: 'profile', label: 'Profile', icon: Icons.user },
]

const TITLES: Record<Tab, string> = {
  home: 'Home', class: 'Your class', materials: 'Course materials',
  payments: 'Payments', profile: 'Your profile',
}

// ── Building blocks ──────────────────────────────────────────────────────────

function Card({ children, tone = 'plain', className = '' }: {
  children: React.ReactNode; tone?: 'plain' | 'accent' | 'warn' | 'danger' | 'ok'; className?: string
}) {
  const tones = {
    plain: 'bg-[var(--paper)] border-[var(--line)]',
    accent: 'bg-[var(--accent-soft)] border-[var(--accent)]/20',
    warn: 'bg-[var(--warn-soft)] border-[var(--warn)]/25',
    danger: 'bg-[var(--danger-soft)] border-[var(--danger)]/25',
    ok: 'bg-[var(--ok-soft)] border-[var(--ok)]/25',
  }
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 mb-3.5 ${tones[tone]} ${className}`}>{children}</div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold text-[var(--ink-faint)] tracking-[0.09em] uppercase mb-3">
      {children}
    </div>
  )
}

function Button({ children, onClick, tone = 'accent', disabled, type = 'button' }: {
  children: React.ReactNode; onClick?: () => void
  tone?: 'accent' | 'ok' | 'ghost'; disabled?: boolean; type?: 'button' | 'submit'
}) {
  const tones = {
    accent: 'bg-[var(--accent)] text-white hover:brightness-110',
    ok: 'bg-[var(--ok)] text-white hover:brightness-110',
    ghost: 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--line)] hover:bg-[var(--line-soft)]',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`w-full min-h-[52px] rounded-xl text-[15px] font-bold inline-flex items-center
        justify-center gap-2.5 transition-all disabled:opacity-45 disabled:pointer-events-none
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
        focus-visible:ring-offset-2 ${tones[tone]}`}>
      {children}
    </button>
  )
}

/** A dismissible message. Replaces alert(), which cannot be styled or read out well. */
function Notice({ text, tone, onClose }: { text: string; tone: 'warn' | 'danger' | 'ok'; onClose: () => void }) {
  const tones = {
    warn: 'bg-[var(--warn-soft)] border-[var(--warn)]/30 text-[var(--warn)]',
    danger: 'bg-[var(--danger-soft)] border-[var(--danger)]/30 text-[var(--danger)]',
    ok: 'bg-[var(--ok-soft)] border-[var(--ok)]/30 text-[var(--ok)]',
  }
  return (
    <div role="status" aria-live="polite"
      className={`rounded-xl border px-4 py-3 mb-3.5 text-[13px] leading-relaxed flex gap-3 ${tones[tone]}`}>
      <span className="flex-1">{text}</span>
      <button onClick={onClose} aria-label="Dismiss"
        className="font-bold opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current rounded px-1">
        ×
      </button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-[var(--line-soft)] last:border-0">
      <span className="text-[13px] text-[var(--ink-soft)]">{label}</span>
      <span className="text-[14px] font-semibold text-[var(--ink)] text-right">{value}</span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed">{children}</p>
}

// ── The portal ───────────────────────────────────────────────────────────────

export default function PortalView({ demo, demoData }: { demo?: boolean; demoData?: PortalData }) {
  // Demo content is initial state rather than something an effect writes, so
  // the first paint is already correct and no cascading render is triggered.
  const [d, setD] = useState<PortalData | null>(demo ? demoData ?? null : null)
  const [loading, setLoading] = useState(!demo)
  const [tab, setTab] = useState<Tab>('home')
  const [installEvt, setInstallEvt] = useState<{ prompt: () => void } | null>(null)
  const [iosHintDismissed, setIosHintDismissed] = useState(false)
  const [paying, setPaying] = useState(false)
  const [joining, setJoining] = useState(false)
  const [amount, setAmount] = useState('')
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'warn' | 'danger' | 'ok' } | null>(null)

  /** Refetch on demand — after paying, or after joining a class. */
  const load = useCallback(async () => {
    if (demo) return
    try {
      const r = await fetch('/api/student/me')
      if (r.status === 401) { window.location.href = '/portal/login'; return }
      setD(await r.json())
    } catch {
      setNotice({ text: 'We could not load your portal. Check your connection and try again.', tone: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [demo])

  // The initial fetch. Written as a promise chain with a cancellation flag so
  // that state is only ever set from a callback — never synchronously in the
  // effect body — and a response arriving after the student has navigated away
  // cannot update an unmounted view.
  useEffect(() => {
    if (demo) return
    let cancelled = false

    fetch('/api/student/me')
      .then(async r => {
        if (r.status === 401) { window.location.href = '/portal/login'; return }
        const json = await r.json()
        if (!cancelled) { setD(json); setLoading(false) }
      })
      .catch(() => {
        if (cancelled) return
        setNotice({ text: 'We could not load your portal. Check your connection and try again.', tone: 'danger' })
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [demo])

  // The install prompt is a genuine external subscription, so state is only
  // set from its callback.
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallEvt(e as unknown as { prompt: () => void }) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  /*
   * Whether to offer the iOS "add to home screen" hint is a one-off read of a
   * platform API, not state the app owns. useSyncExternalStore reads it during
   * render with an explicit server snapshot of false, which both avoids a
   * hydration mismatch and keeps it out of an effect.
   */
  const isIosBrowser = useSyncExternalStore(
    () => () => {},
    () => /iphone|ipad|ipod/i.test(navigator.userAgent)
      && !window.matchMedia('(display-mode: standalone)').matches
      && !(navigator as Navigator & { standalone?: boolean }).standalone,
    () => false,
  )
  const showIos = isIosBrowser && !iosHintDismissed

  async function pay() {
    if (demo) { setNotice({ text: 'In the live portal this opens Paystack to pay by mobile money or card.', tone: 'ok' }); return }
    const amt = Number(amount)
    const min = Number(d?.session?.minTopUp || 0)
    if (!(amt > 0)) { setNotice({ text: 'Enter the amount you would like to pay.', tone: 'warn' }); return }
    if (min > 0 && amt + 0.01 < min) {
      setNotice({ text: `You need to pay at least ${ghs(min)} to join the next class. You may pay more.`, tone: 'warn' })
      return
    }
    setPaying(true)
    try {
      const init = await fetch('/api/student/pay-init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      }).then(r => r.json())
      if (init?.authorization_url) { window.location.href = init.authorization_url; return }
      setNotice({ text: init?.error || 'We could not start the payment. Please try again.', tone: 'danger' })
    } catch {
      setNotice({ text: 'We could not reach the payment service. Please try again.', tone: 'danger' })
    } finally {
      setPaying(false)
    }
  }

  async function joinClass() {
    if (demo) { setNotice({ text: 'In the live portal this opens Zoom on your phone or laptop.', tone: 'ok' }); return }
    setJoining(true)
    try {
      // The server issues a one-time entry link; the Zoom URL never reaches the
      // browser, so it cannot be copied and shared with someone who has not paid.
      const r = await fetch('/api/student/join', { method: 'POST' }).then(x => x.json())
      if (r?.url) { window.location.href = r.url; setTimeout(load, 3000); return }
      if (r?.error === 'payment_required') {
        setNotice({ text: `You need to pay at least ${ghs(r.minTopUp)} to join this session.`, tone: 'warn' })
        setTab('payments'); load(); return
      }
      if (r?.error === 'cohort_ended') {
        setNotice({ text: 'This class has ended. Please contact the administration.', tone: 'warn' })
        load(); return
      }
      setNotice({ text: 'We could not open the class. Please try again.', tone: 'danger' })
    } catch {
      setNotice({ text: 'We could not open the class. Check your connection and try again.', tone: 'danger' })
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-[var(--canvas)]">
        <div role="status" aria-label="Loading your portal"
          className="w-9 h-9 rounded-full border-[3px] border-[var(--line)] border-t-[var(--accent)] animate-spin" />
      </div>
    )
  }

  const f = d?.fee, s = d?.session
  const first = (d?.student?.name || '').split(' ')[0] || 'there'
  const pct = f?.total ? Math.min(100, (f.paid / f.total) * 100) : 0

  // ── Shared pieces ──

  const installBanner = () => (
    <>
      {installEvt && (
        <Card tone="accent">
          <div className="font-bold text-[14px] text-[var(--ink)]">Install your portal</div>
          <p className="text-[13px] text-[var(--ink-soft)] mt-1.5 mb-3.5 leading-relaxed">
            Add it to your home screen so it opens like an app.
          </p>
          <Button onClick={() => { installEvt.prompt(); setInstallEvt(null) }}>Install</Button>
        </Card>
      )}
      {showIos && !installEvt && (
        <Card tone="accent">
          <div className="font-bold text-[14px] text-[var(--ink)]">Add to your home screen</div>
          <p className="text-[13px] text-[var(--ink-soft)] mt-1.5 leading-relaxed">
            In Safari, tap <b>Share</b> at the bottom of the screen, then choose <b>Add to Home Screen</b>.
          </p>
          <button onClick={() => setIosHintDismissed(true)}
            className="text-[var(--accent)] text-[13px] font-bold mt-2.5 focus-visible:outline-none focus-visible:underline">
            Got it
          </button>
        </Card>
      )}
    </>
  )

  const classStatus = () => {
    if (!d?.batch) return <Empty>Your class will appear here once you have been added to a group.</Empty>
    if (!s) return null

    if (s.cohortEnded) return (
      <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] p-4">
        <div className="text-[14px] font-bold text-[var(--danger)]">This class has ended</div>
        <p className="text-[13px] text-[var(--ink-soft)] mt-2 leading-relaxed">
          Your group finished{s.endDate ? ` on ${longDate(s.endDate)}` : ''}, so the class link is no longer
          available. To rejoin, please contact the administration to be placed in a new group.
        </p>
      </div>
    )

    if (s.canJoin) return (
      <>
        <Button tone="ok" onClick={joinClass} disabled={joining}>
          {Icons.video}{joining ? 'Opening…' : 'Join class'}
        </Button>
        <p className="text-[12px] text-[var(--ink-faint)] text-center mt-2.5">
          Opens Zoom on your phone or laptop.
        </p>
      </>
    )

    return (
      <div className="rounded-xl border border-[var(--warn)]/25 bg-[var(--warn-soft)] p-4">
        <div className="text-[14px] font-bold text-[var(--warn)]">Payment required to join</div>
        <p className="text-[13px] text-[var(--ink-soft)] mt-2 mb-3.5 leading-relaxed">
          Pay at least <b className="text-[var(--ink)]">{ghs(s.minTopUp || 0)}</b> to unlock
          session {s.sessionNumber}. You may pay more.
        </p>
        <Button onClick={() => setTab('payments')}>Make payment</Button>
      </div>
    )
  }

  const feeSummary = () => f ? (
    <>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-[24px] font-semibold text-[var(--ink)] leading-none tabular-nums">
            {ghs(f.balance)}
          </div>
          <div className="text-[12px] text-[var(--ink-faint)] mt-1.5">
            {f.balance > 0 ? 'still to pay' : 'fully paid — thank you'}
          </div>
        </div>
        <div className="text-right text-[12px] text-[var(--ink-soft)]">
          <div className="tabular-nums">{ghs(f.paid)} paid</div>
          <div className="tabular-nums text-[var(--ink-faint)]">of {ghs(f.total)}</div>
        </div>
      </div>
      <div className="h-2 rounded-full bg-[var(--line-soft)] overflow-hidden"
        role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
        aria-label="Fees paid">
        <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
          style={{ width: `${pct}%` }} />
      </div>
    </>
  ) : <Empty>Your fee details will appear here once your registration is complete.</Empty>

  // ── Tab panels ──

  const panels: Record<Tab, React.ReactNode> = {
    home: (
      <>
        {installBanner()}
        <Card>
          <Label>Next class</Label>
          {d?.batch ? (
            <>
              <div className="text-[17px] font-bold text-[var(--ink)]">{d.batch.name}</div>
              {d.batch.schedule && (
                <div className="text-[13px] text-[var(--ink-soft)] mt-1">{d.batch.schedule}</div>
              )}
              {s && !s.cohortEnded && (
                <div className="text-[13px] text-[var(--ink-faint)] mt-2">
                  {s.sectionNo ? `${s.sectionTitle || `Section ${s.sectionNo}`} · ` : ''}
                  Session {s.sessionNumber}{s.signedInToday ? ' · you signed in today' : ''}
                </div>
              )}
              <div className="mt-4">{classStatus()}</div>
            </>
          ) : classStatus()}
        </Card>

        <Card>
          <Label>Fees</Label>
          {feeSummary()}
          {f && f.balance > 0 && (
            <div className="mt-4"><Button onClick={() => setTab('payments')}>Make a payment</Button></div>
          )}
        </Card>

        {d?.certificate?.final_url && (
          <Card tone="ok">
            <Label>Your certificate</Label>
            <div className="flex items-center gap-3">
              <span className="text-[var(--ok)]">{Icons.award}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold text-[var(--ink)] truncate">
                  {d.certificate.course_name || 'Certificate'}
                </div>
                {d.certificate.certificate_number && (
                  <div className="text-[12px] text-[var(--ink-soft)]">{d.certificate.certificate_number}</div>
                )}
              </div>
              <a href={d.certificate.final_url} target="_blank" rel="noopener noreferrer"
                className="text-[13px] font-bold text-[var(--ok)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ok)] rounded px-1">
                Open
              </a>
            </div>
          </Card>
        )}
      </>
    ),

    class: (
      <Card>
        <Label>Your class</Label>
        {d?.batch ? (
          <>
            <div className="text-[17px] font-bold text-[var(--ink)]">{d.batch.name}</div>
            {d.course && <div className="text-[13px] text-[var(--ink-soft)] mt-1">{d.course}</div>}
            <div className="mt-3">
              {d.batch.schedule && <Row label="Schedule" value={d.batch.schedule} />}
              {d.batch.startDate && <Row label="Starts" value={longDate(d.batch.startDate)} />}
              {d.student?.classModeLabel && <Row label="Class type" value={d.student.classModeLabel} />}
              {s?.sessionNumber !== undefined && <Row label="Session" value={s.sessionNumber} />}
            </div>
            <div className="mt-4">{classStatus()}</div>
          </>
        ) : classStatus()}
      </Card>
    ),

    materials: (
      <Card>
        <Label>Course materials</Label>
        {!d?.materials?.unlocked?.length && !d?.materials?.locked?.length && (
          <Empty>Your course materials will appear here once your class begins.</Empty>
        )}

        {d?.materials?.unlocked?.map(m => (
          <button key={m.id} onClick={() => m.id && setViewing({ id: m.id, name: m.name })}
            className="w-full flex items-center gap-3 py-3 border-b border-[var(--line-soft)] last:border-0
              text-left min-h-[52px] rounded-lg focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-[var(--accent)] hover:bg-[var(--line-soft)] px-1 transition-colors">
            <span className="text-[var(--accent)] shrink-0">{Icons.doc}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold text-[var(--ink)] truncate">{m.name}</span>
              {m.section && <span className="block text-[12px] text-[var(--ink-faint)]">Section {m.section}</span>}
            </span>
            <span className="text-[12px] font-bold text-[var(--accent)]">Open</span>
          </button>
        ))}

        {d?.materials?.locked?.map((m, i) => (
          <div key={`locked-${i}`} className="flex items-center gap-3 py-3 border-b border-[var(--line-soft)] last:border-0 opacity-70">
            <span className="text-[var(--ink-faint)] shrink-0">{Icons.lock}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold text-[var(--ink-soft)] truncate">{m.name}</span>
              <span className="block text-[12px] text-[var(--ink-faint)]">
                Unlocks after {ghs(m.unlockAt || 0)} paid
              </span>
            </span>
          </div>
        ))}
      </Card>
    ),

    payments: (
      <>
        <Card>
          <Label>Balance</Label>
          {feeSummary()}
        </Card>

        {f && f.balance > 0 && (
          <Card>
            <Label>Make a payment</Label>
            <label htmlFor="pay-amount" className="block text-[13px] text-[var(--ink-soft)] mb-2">
              Amount in Ghana cedis
            </label>
            <input id="pay-amount" type="number" inputMode="decimal" min="1" value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={s?.minTopUp ? String(s.minTopUp) : '0.00'}
              className="w-full h-[52px] px-4 rounded-2xl border-2 border-[var(--line)] bg-[var(--paper)]
                text-[15px] text-[var(--ink)] mb-3 focus:outline-none focus:border-[var(--accent)] transition-colors" />
            {s?.minTopUp ? (
              <p className="text-[12px] text-[var(--ink-faint)] mb-3">
                At least {ghs(s.minTopUp)} to unlock the next session. You may pay more.
              </p>
            ) : null}
            <Button onClick={pay} disabled={paying}>{paying ? 'Opening payment…' : 'Pay now'}</Button>
          </Card>
        )}

        <Card>
          <Label>Payment history</Label>
          {!d?.payments?.length && <Empty>Your payments will be listed here.</Empty>}
          {d?.payments?.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-3 border-b border-[var(--line-soft)] last:border-0">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[var(--ink)] tabular-nums">{ghs(p.amount)}</div>
                <div className="text-[12px] text-[var(--ink-faint)]">
                  {longDate(p.created_at)}{p.method ? ` · ${p.method}` : ''}
                </div>
              </div>
              {p.receipt_number && (
                <div className="text-[12px] text-[var(--ink-faint)] font-mono shrink-0">{p.receipt_number}</div>
              )}
            </div>
          ))}
        </Card>
      </>
    ),

    profile: (
      <>
        <Card>
          <Label>Your details</Label>
          <Row label="Name" value={d?.student?.name || '—'} />
          <Row label="Phone" value={d?.student?.phone || '—'} />
          <Row label="Programme" value={d?.course || '—'} />
          <Row label="Class type" value={d?.student?.classModeLabel || 'Not set'} />
          {d?.student?.admissionNumber && <Row label="Admission number" value={d.student.admissionNumber} />}
          {d?.student?.admissionStatus && (
            <Row label="Admission status" value={
              <span className="capitalize">{String(d.student.admissionStatus).replace(/_/g, ' ')}</span>
            } />
          )}
        </Card>

        <Card>
          <Label>Your documents</Label>
          {d?.admission?.letterUrl ? (
            <a href={d.admission.letterUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 py-3 min-h-[52px] rounded-lg px-1 hover:bg-[var(--line-soft)]
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-colors">
              <span className="text-[var(--accent)] shrink-0">{Icons.doc}</span>
              <span className="flex-1 text-[14px] font-semibold text-[var(--ink)]">Admission letter</span>
              <span className="text-[12px] font-bold text-[var(--accent)]">Open</span>
            </a>
          ) : (
            <Empty>
              Your admission letter will appear here once your admission has been processed.
            </Empty>
          )}
        </Card>

        <Card>
          <Label>Signing out</Label>
          <p className="text-[13px] text-[var(--ink-soft)] mb-3.5 leading-relaxed">
            You will need your sign-in link to get back in. If you lose it, contact the office.
          </p>
          <Button tone="ghost" onClick={async () => {
            if (demo) { setNotice({ text: 'Sign out is disabled in the demo.', tone: 'ok' }); return }
            await fetch('/api/student/auth', { method: 'DELETE' }).catch(() => {})
            window.location.href = '/portal/login'
          }}>
            Sign out
          </Button>
        </Card>
      </>
    ),
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--canvas)] lg:flex">

      {/* Desktop side rail — same information architecture, laid out for a pointer */}
      <nav aria-label="Portal sections"
        className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:border-r lg:border-[var(--line)] lg:bg-[var(--paper)] lg:p-4">
        <div className="px-3 py-4 mb-2">
          <div className="text-[11px] uppercase tracking-[0.06em] text-[var(--ink-faint)] font-semibold">
            Cambridge CE
          </div>
          <div className="text-[15px] font-semibold text-[var(--ink)] mt-1 leading-snug">
            {d?.student?.name || 'Student portal'}
          </div>
        </div>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            aria-current={tab === t.k ? 'page' : undefined}
            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-[14px] font-semibold mb-1
              transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
              ${tab === t.k
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--ink-soft)] hover:bg-[var(--line-soft)]'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <header className="bg-[var(--accent)] text-white px-5 pt-5 pb-6 lg:pb-5">
          <div className="max-w-[640px] mx-auto lg:max-w-none">
            <div className="text-[11px] uppercase tracking-[0.05em] opacity-80 lg:hidden">
              Cambridge Center of Excellence
            </div>
            <h1 className="text-[20px] font-bold mt-1.5 tracking-[-0.01em] lg:mt-0">
              {tab === 'home' ? `Hello, ${first}` : TITLES[tab]}
            </h1>
            {d?.course && <div className="text-[13px] opacity-90 mt-1">{d.course}</div>}
          </div>
        </header>

        {/* Panel */}
        <main className="px-4 py-4 max-w-[640px] mx-auto lg:max-w-3xl lg:px-6 pb-[calc(86px+env(safe-area-inset-bottom))] lg:pb-10">
          {notice && <Notice text={notice.text} tone={notice.tone} onClose={() => setNotice(null)} />}
          <div role="tabpanel" aria-label={TITLES[tab]}>{panels[tab]}</div>
        </main>
      </div>

      {/* Mobile tab bar — thumb-reachable, safe-area aware, 5 targets ≥ 56px */}
      <nav aria-label="Portal sections"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--paper)] border-t border-[var(--line)]
          pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 max-w-[640px] mx-auto">
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              aria-current={tab === t.k ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 min-h-[58px] py-2
                transition-colors focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-inset focus-visible:ring-[var(--accent)]
                ${tab === t.k ? 'text-[var(--accent)]' : 'text-[var(--ink-faint)]'}`}>
              {t.icon}
              <span className="text-[11px] font-semibold leading-none">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {viewing && (
        <MaterialViewer id={viewing.id} name={viewing.name} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
