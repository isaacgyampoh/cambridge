'use client'
import { useState, useEffect, useMemo } from 'react'
import { readableStatus } from '@/lib/ui/status'
import { PageHeader, Card, Button, Field, inputClass, textareaClass, Spinner, EmptyState, Badge } from '@/components/ui'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { postJson, messageFor } from '@/lib/api/post'
import type { Progress } from '@/lib/infoSessionCampaign'
import type { AudienceFilter } from '@/lib/leads/audienceFilter'
import { countSegments, PLACEHOLDERS } from '@/lib/leads/messageTemplate'
import { Dialog } from '@/components/ui/overlays'
import { displayPhone } from '@/lib/ui/contact'
import { AudiencePicker } from './AudiencePicker'
import { RecipientsDialog } from './RecipientsDialog'

/** Which recipient state a progress figure opens. */
const STATUS_FOR: Record<string, string> = {
  Submitted: 'sent',
  Processing: 'claimed',
  Remaining: 'pending',
  Failed: 'failed',
  'No usable number': 'unreachable',
}

export default function InfoSessions() {
  const { confirm, dialog } = useConfirm()
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '', link: '', description: '', scheduled_at: '', notify_at: '',
    audience: 'all_leads', channels: ['sms', 'whatsapp'],
    /*
     * Empty on purpose. There is no default message: whoever creates the
     * campaign writes what they want to say, and an empty one is refused
     * rather than quietly replaced — see the note in the API route.
     */
    message: '',
  })
  /** The audience conditions, and what they currently match. */
  const [filter, setFilter] = useState<AudienceFilter>({})
  const [audience, setAudience] = useState<{
    matching: number; sendable: number; excluded: number
    conditions: string[]
    sample: Array<{ id: string; full_name: string | null; phone: string | null; status: string | null; course_interest: string | null }>
    excludedSample: Array<{ id: string; full_name: string | null; phone: string | null; reason: string }>
  } | null>(null)
  const [audienceState, setAudienceState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [showMatching, setShowMatching] = useState(false)
  /** Which campaign's recipients are open, and from which figure. */
  const [inspect, setInspect] = useState<{ id: string; title: string; status?: string | null } | null>(null)
  const [attendance, setAttendance] = useState<any[]>([])

  /*
   * How many leads the current conditions match, counted against every lead.
   *
   * Debounced, because it re-runs as somebody builds the filter, and counted
   * on the SERVER: a count taken over the page of leads a browser happens to
   * hold is right about that page and wrong about the campaign, and the
   * operator finds that out after pressing Send.
   */
  useEffect(() => {
    let alive = true
    setAudienceState('loading')
    const t = setTimeout(async () => {
      try {
        const d = await fetch('/api/info-sessions/audience', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(filter),
        }).then(r => r.json())
        if (!alive) return
        if (!d.success) { setAudienceState('error'); return }
        setAudience(d)
        setAudienceState('idle')
      } catch { if (alive) setAudienceState('error') }
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [filter])

  async function load() {
    const d = await fetch('/api/info-sessions').then(r => r.json())
    setSessions(d.sessions || [])
    setLoading(false)
    fetch('/api/info-sessions/attendance').then(r => r.json()).then(d => setAttendance(d.sessions || [])).catch(() => {})
  }
  useEffect(() => { load() }, [])

  /*
   * Live progress for anything still sending.
   *
   * Polled while at least one campaign is in flight and stopped the moment
   * none are, so an idle screen is not asking the server a question every
   * four seconds for ever.
   */
  const [progress, setProgress] = useState<Record<string, Progress>>({})

  const sending = useMemo(
    () => sessions.filter((x: any) => x.status === 'sending').map((x: any) => x.id),
    [sessions],
  )

  useEffect(() => {
    if (!sending.length) return
    let alive = true

    const tick = async () => {
      const entries = await Promise.all(sending.map(async (id: string) => {
        try {
          const d = await fetch(`/api/info-sessions/progress?session=${encodeURIComponent(id)}`)
            .then(r => (r.ok ? r.json() : null))
          return d?.success ? ([id, d] as const) : null
        } catch { return null }
      }))
      if (!alive) return

      const next: Record<string, Progress> = {}
      let anyComplete = false
      for (const e of entries) {
        if (!e) continue
        next[e[0]] = e[1]
        if (e[1].complete) anyComplete = true
      }
      setProgress(p => ({ ...p, ...next }))
      // One finished: reload so its status and totals are the server's.
      if (anyComplete) load()
    }

    tick()
    const timer = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [sending.join(',')])

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })) }

  /** What the message costs to send, and how it reads for a real recipient. */
  const segments = useMemo(() => countSegments(form.message), [form.message])
  const isEmptySelection = useMemo(
    () => Object.values(filter).every(v => v === undefined || (Array.isArray(v) && !v.length) || v === 'any'),
    [filter],
  )
  const messagePreview = useMemo(() => {
    const first = audience?.sample?.[0]
    return form.message
      .replace(/\{name\}/g, String(first?.full_name || 'Ama').split(' ')[0])
      .replace(/\{title\}/g, form.title || 'the session')
      .replace(/\{when\}/g, form.scheduled_at
        ? new Date(form.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        : 'the session time')
      .replace(/\{link\}/g, 'https://portal.cambridge.edu.gh/j/…')
  }, [form.message, form.title, form.scheduled_at, audience])

  /**
   * A campaign has STARTED. Not what it sent — it has not sent it yet.
   *
   * This used to report the outcome of the one batch the request managed,
   * and then tell the operator how many were "left to send" and to press the
   * button again. Pressing a button repeatedly is not a progress bar. The
   * campaign now runs itself and the row below reports where it has got to.
   */
  function reportStart(d: any, toastId?: string) {
    toast.success(
      d.message || `Sending to ${d.recipients} lead${d.recipients === 1 ? '' : 's'}. It continues on its own.`,
      toastId ? { id: toastId } : undefined,
    )
  }

  function blank() {
    setForm({
      title: '', link: '', description: '', scheduled_at: '', notify_at: '',
      audience: 'all_leads', channels: ['sms', 'whatsapp'], message: '',
    })
    setFilter({})
  }

  /**
   * Create the session — and, when asked, send it there and then.
   *
   * `sendNow` skips the auto-send time, because "now" is the answer to that
   * question. It confirms first: the invitation goes to every targeted lead
   * and cannot be recalled, which is the same reason the Send button on a
   * saved session confirms.
   */
  async function create(sendNow = false) {
    if (!form.title.trim() || !form.link.trim() || !form.scheduled_at) {
      toast.error('Fill in the title, link and the session time.'); return
    }
    if (!sendNow && !form.notify_at) {
      toast.error('Choose when it should auto-send — or send it now.'); return
    }
    if (!form.channels.length) {
      toast.error('Choose at least one way to send it.'); return
    }
    if (!form.message.trim()) {
      toast.error('Write the message you want to send.'); return
    }
    if (!audience?.sendable) {
      toast.error('No leads with a usable phone number match your selection.'); return
    }

    if (sendNow && !await confirm({
      title: 'Create and send it now?',
      message: `"${form.title.trim()}" goes to ${audience?.sendable ?? 0} lead${audience?.sendable === 1 ? '' : 's'}. `
        + 'Sending starts now and continues on its own — it cannot be recalled.',
      confirmLabel: 'Send now',
      tone: 'accent',
    })) return

    setSaving(true)
    const res = await fetch('/api/info-sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, channels: form.channels.join(','), send_now: sendNow, filter }),
    })
    const d = await res.json()
    setSaving(false)

    if (!d.session) { toast.error(d.error || 'Could not schedule.'); return }

    /*
     * Saved either way. When the send failed the session is still there to
     * be sent from the list, and saying only "could not send" would read as
     * though nothing had been kept.
     */
    if (sendNow && d.started) reportStart(d)
    else if (sendNow) toast.error(d.error || 'Saved, but it could not be started. Start it from the list.', { duration: 10_000 })
    else toast.success('Info session scheduled. It will send automatically.')

    blank()
    load()
  }

  async function cancel(id: string) {
    /*
     * "Cancelled" was announced before anything had been read back, with no
     * try/catch around it. A session that is still scheduled — and whose
     * invitations will still go out to every targeted lead — showing as
     * cancelled is the wrong way round to be wrong.
     */
    try {
      await postJson('/api/info-sessions', { id, action: 'cancel' },
        { method: 'PATCH', fallback: 'That session could not be cancelled.' })
      toast.success('Cancelled. No invitations will be sent.')
    } catch (e) {
      toast.error(messageFor(e, 'That session could not be cancelled.'))
    }
    load()
  }

  async function sendNow(id: string, title: string) {
    if (!await confirm({
      title: 'Send this session invitation now?',
      message: `"${title}" goes to every targeted lead. Sending starts now and continues on its own — it cannot be recalled.`,
      confirmLabel: 'Send now',
      tone: 'accent',
    })) return
    toast.loading('Sending…', { id: 'sn' })
    const res = await fetch('/api/info-sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'send_now' }) })
    const d = await res.json()
    if (!d.started) { toast.error(d.error || 'Could not start sending', { id: 'sn' }); load(); return }

    /*
     * What actually happened, not "sent".
     *
     * This said "Sent to N leads" from a count that included every lead a
     * disconnected WhatsApp had merely RECORDED — so a session that reached
     * nobody reported a clean success. The five figures are kept apart, and
     * reported by the same function the create-and-send path uses.
     */
    reportStart(d, 'sn')
    load()
  }

  function toggleChannel(c: string) {
    setForm(f => ({ ...f, channels: f.channels.includes(c) ? f.channels.filter(x => x !== c) : [...f.channels, c] }))
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}

      <RecipientsDialog
        sessionId={inspect?.id || null}
        title={inspect?.title || ''}
        status={inspect?.status || null}
        onClose={() => setInspect(null)}
      />

      {/*
        * The matching leads, before anything is created. Separate from the
        * recipient list, which is about a campaign that already exists.
        */}
      <Dialog
        open={showMatching}
        onClose={() => setShowMatching(false)}
        size="lg"
        title="Leads that match your selection"
        description={audience
          ? `${audience.matching} matching · ${audience.sendable} can be texted · ${audience.excluded} without a usable number`
          : ''}
        footer={<Button variant="secondary" onClick={() => setShowMatching(false)}>Close</Button>}
      >
        {audience?.conditions?.length ? (
          <p className="text-[13px] text-[var(--ink-soft)] mb-3">{audience.conditions.join(' · ')}</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ink-faint)] border-b border-[var(--line)]">
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">Phone</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Course</th>
              </tr>
            </thead>
            <tbody>
              {(audience?.sample || []).map(l => (
                <tr key={l.id} className="border-b border-[var(--line-soft)] last:border-0">
                  <td className="px-2 py-2 font-medium text-[var(--ink)]">{l.full_name || 'Unnamed'}</td>
                  <td className="px-2 py-2 text-[var(--ink-soft)] tabular-nums">{displayPhone(l.phone)}</td>
                  <td className="px-2 py-2 text-[var(--ink-soft)]">{l.status?.replace(/_/g, ' ') || '—'}</td>
                  <td className="px-2 py-2 text-[var(--ink-soft)]">{l.course_interest || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {audience && audience.matching > audience.sample.length && (
          <p className="text-[12px] text-[var(--ink-faint)] mt-3">
            Showing the first {audience.sample.length} of {audience.matching}. All of them are included.
          </p>
        )}
        {(audience?.excludedSample?.length ?? 0) > 0 && (
          <div className="mt-4 pt-3 border-t border-[var(--line-soft)]">
            <h4 className="text-[13px] font-semibold text-[var(--ink)] mb-1.5">
              Will not receive it — no usable phone number
            </h4>
            <ul className="text-[12px] text-[var(--ink-soft)] space-y-0.5">
              {(audience?.excludedSample || []).map(l => (
                <li key={l.id}>{l.full_name || 'Unnamed'} — {l.phone || 'no number'} ({l.reason})</li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
      <PageHeader eyebrow="Automation" title="Info sessions"
        description="Schedule an info session once. At the send time, the system automatically texts and WhatsApps every lead, and pushes the link to all marketers to share. No manual sending." />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        {/* Scheduled sessions */}
        <div>
          {loading ? <Spinner /> : sessions.length === 0 ? (
            <EmptyState title="No info sessions yet" description="Schedule your first one on the right — it will broadcast automatically at the time you set." />
          ) : (
            <div className="space-y-3">
              {sessions.map(s => {
                const when = new Date(s.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                const sendWhen = new Date(s.notify_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                return (
                  <Card key={s.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-[15px] font-semibold text-[var(--ink)]">{s.title}</h3>
                          <Badge tone={s.status === 'sent' ? 'success' : s.status === 'cancelled' ? 'danger' : 'accent'}>{readableStatus(s.status)}</Badge>
                        </div>
                        <p className="text-[13px] text-[var(--ink-soft)] mt-1">Session: {when}</p>
                        {s.status === 'scheduled' && <p className="text-[13px] text-[var(--ink-faint)]">Auto-sends: {sendWhen}</p>}
                        {s.status === 'sent' && (
                          <p className="text-[13px] text-[var(--ink-soft)]">
                            {/*
                              * Clickable, because "sent to 212 leads" invites
                              * exactly one question — which 212 — and the
                              * recipient ledger can answer it.
                              */}
                            <button onClick={() => setInspect({ id: s.id, title: s.title })}
                              className="text-[var(--ok)] font-semibold hover:underline tabular-nums">
                              {s.leads_notified} recipient{s.leads_notified === 1 ? '' : 's'}
                            </button>
                            {' · '}
                            <button onClick={() => setInspect({ id: s.id, title: s.title, status: 'failed' })}
                              className="hover:underline">failed</button>
                            {' · '}
                            <button onClick={() => setInspect({ id: s.id, title: s.title, status: 'unreachable' })}
                              className="hover:underline">no usable number</button>
                          </p>
                        )}
                        {s.message && (
                          <details className="mt-2">
                            <summary className="text-[13px] text-[var(--accent)] cursor-pointer hover:underline">
                              The message that was sent
                            </summary>
                            <p className="text-[13px] text-[var(--ink-soft)] whitespace-pre-wrap mt-1.5 rounded-lg bg-[var(--canvas)] border border-[var(--line-soft)] p-2.5 leading-relaxed">
                              {s.message}
                            </p>
                          </details>
                        )}
                        {Array.isArray(s.audience_summary?.conditions) && s.audience_summary.conditions.length > 0 && (
                          <p className="text-[12px] text-[var(--ink-faint)] mt-1.5">
                            Audience: {s.audience_summary.conditions.join(' · ')}
                          </p>
                        )}
                        <a href={s.link} target="_blank" className="text-[13px] text-[var(--accent)] hover:underline break-all">{s.link}</a>

                        {/*
                          * Where it has got to, while it gets there.
                          *
                          * Read from the recipient ledger every few seconds —
                          * so "sent" is people a channel accepted, not a
                          * figure the first batch guessed. The operator can
                          * close this page; the campaign is not running in it.
                          */}
                        {s.status === 'sending' && (
                          <div className="mt-3 rounded-xl bg-[var(--canvas)] border border-[var(--line)] p-3">
                            {progress[s.id] ? (
                              <>
                                <div className="flex items-baseline justify-between gap-3 mb-2">
                                  <span className="text-[13px] font-semibold text-[var(--ink)]">Sending…</span>
                                  <span className="text-[12px] text-[var(--ink-soft)] tabular-nums">
                                    {progress[s.id].sent + progress[s.id].failed + progress[s.id].unreachable}
                                    {' of '}{progress[s.id].total}
                                  </span>
                                </div>
                                <div className="h-2 rounded-full bg-[var(--line-soft)] overflow-hidden mb-2">
                                  <div className="h-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
                                    style={{ width: `${Math.round(((progress[s.id].sent + progress[s.id].failed + progress[s.id].unreachable) / Math.max(1, progress[s.id].total)) * 100)}%` }} />
                                </div>
                                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[12px]">
                                  {[
                                    ['Total', progress[s.id].total, 'var(--ink-soft)'],
                                    ['Submitted', progress[s.id].sent, 'var(--ok)'],
                                    ['Processing', progress[s.id].processing, 'var(--ink-soft)'],
                                    ['Remaining', progress[s.id].pending, 'var(--ink-soft)'],
                                    ['Failed', progress[s.id].failed, progress[s.id].failed ? 'var(--danger)' : 'var(--ink-faint)'],
                                    ['No usable number', progress[s.id].unreachable, progress[s.id].unreachable ? 'var(--warn)' : 'var(--ink-faint)'],
                                  ].map(([label, value, tone]) => (
                                    <div key={String(label)} className="flex justify-between gap-2">
                                      <dt className="text-[var(--ink-faint)]">{label}</dt>
                                      <dd className="font-semibold tabular-nums" style={{ color: String(tone) }}>
                                        {Number(value) > 0 && STATUS_FOR[String(label)] ? (
                                          <button onClick={() => setInspect({ id: s.id, title: s.title, status: STATUS_FOR[String(label)] })}
                                            className="hover:underline">{value}</button>
                                        ) : value}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                                {progress[s.id].badNumbers?.length > 0 && (
                                  <p className="text-[11px] text-[var(--warn)] mt-2 leading-snug">
                                    Need correcting: {progress[s.id].badNumbers.slice(0, 3).join(', ')}
                                    {progress[s.id].badNumbers.length > 3 ? ` and ${progress[s.id].badNumbers.length - 3} more` : ''}
                                  </p>
                                )}
                                <p className="text-[11px] text-[var(--ink-faint)] mt-2">
                                  It carries on by itself. You can close this page.
                                </p>
                              </>
                            ) : (
                              <p className="text-[13px] text-[var(--ink-soft)]">Starting…</p>
                            )}
                          </div>
                        )}
                      </div>
                      {s.status === 'scheduled' && (
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <button onClick={() => sendNow(s.id, s.title)} className="text-[13px] text-white bg-[var(--accent)] px-3 py-1.5 rounded-lg font-semibold hover:brightness-110">Send now</button>
                          <button onClick={() => cancel(s.id)} className="text-[13px] text-[var(--danger)] font-medium">Cancel</button>
                        </div>
                      )}
                      {/*
                        * Stopping one that is already going. The worker reads
                        * the status before each batch, so this stops the next
                        * batch rather than pretending to recall what has gone.
                        */}
                      {s.status === 'sending' && (
                        <button onClick={() => cancel(s.id)} className="text-[13px] text-[var(--danger)] font-medium flex-shrink-0">
                          Stop sending
                        </button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Attendance leaderboard — who drove the most joins */}
          {attendance.length > 0 && (
            <div className="mt-6">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h3 className="font-display text-[15px] font-semibold text-[var(--ink)]">Who drove attendance</h3>
              </div>
              {/*
                * Said plainly, because the heading alone was being read as
                * "who sent the invitations" — which is a different question
                * from any of the three answered below.
                */}
              <p className="text-[12px] text-[var(--ink-faint)] leading-snug mb-3">
                Which lead sources and staff members contributed to the people who attended.
                Each person is counted once, however many times they opened the link.
                “Invited” is how many the campaign actually messaged.
              </p>
              <div className="space-y-3">
                {attendance.map((sess: any) => (
                  <Card key={sess.session_id} className="p-5">
                    <div className="flex items-baseline justify-between gap-3 mb-3">
                      <div className="font-medium text-[var(--ink)] truncate pr-3">{sess.title}</div>
                      <div className="text-[13px] text-[var(--ink-soft)] flex-shrink-0 tabular-nums">
                        <span className="font-semibold text-[var(--accent)]">{sess.attended}</span> attended
                        {sess.invited !== null && <> of {sess.invited} invited</>}
                        {sess.attendanceRate !== null && <> · {sess.attendanceRate}%</>}
                      </div>
                    </div>

                    {/*
                      * Three breakdowns of the SAME people, each answering its
                      * own question. Whose link was clicked is who invited
                      * them — not who found them and not who is responsible
                      * for them, and on this data those are usually different.
                      */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      {[
                        ['Where they came from', sess.bySource, 'The source recorded on the lead'],
                        ['Who is responsible', sess.byOwner, 'The staff member the lead is assigned to'],
                        ['Whose link they used', sess.byInviter, 'The invitation they opened'],
                      ].map(([heading, rows, hint]: any) => (
                        <div key={heading}>
                          <div className="text-[12px] font-semibold text-[var(--ink)]">{heading}</div>
                          <div className="text-[11px] text-[var(--ink-faint)] mb-1.5 leading-snug">{hint}</div>
                          {rows.length === 0 ? (
                            <p className="text-[12px] text-[var(--ink-faint)]">Nothing recorded.</p>
                          ) : (
                            <table className="w-full text-[12px]">
                              <tbody>
                                {rows.map((r: any) => (
                                  <tr key={r.key}>
                                    <td className={`py-0.5 pr-2 ${r.label === 'Not recorded' ? 'text-[var(--ink-faint)] italic' : 'text-[var(--ink-soft)]'}`}>
                                      {r.label}
                                    </td>
                                    <td className="py-0.5 text-right font-semibold text-[var(--ink)] tabular-nums w-8">
                                      {r.attended}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      ))}
                    </div>

                    {sess.invited !== null && (
                      <p className="text-[12px] text-[var(--ink-faint)] mt-3 pt-2 border-t border-[var(--line-soft)]">
                        <button onClick={() => setInspect({ id: sess.session_id, title: sess.title })}
                          className="text-[var(--accent)] hover:underline">
                          {sess.invited} invited
                        </button>
                        {sess.absent !== null && <> · {sess.absent} did not attend</>}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Schedule form */}
        <Card className="p-6">
          <h3 className="font-display text-[15px] font-semibold text-[var(--ink)] mb-4">Schedule a session</h3>
          <div className="space-y-4">
            <Field label="Title"><input className={inputClass} placeholder="PMP Info Session" value={form.title} onChange={e => set('title', e.target.value)} /></Field>
            <Field label="Meeting link"><input className={inputClass} placeholder="https://zoom.us/j/..." value={form.link} onChange={e => set('link', e.target.value)} /></Field>
            <Field label="Note (optional)"><textarea className={textareaClass} rows={2} placeholder="Bring your questions!" value={form.description} onChange={e => set('description', e.target.value)} /></Field>
            <Field label="When is the session?"><input type="datetime-local" className={inputClass} value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} /></Field>
            <Field label="When should it auto-send? (only if scheduling)"><input type="datetime-local" className={inputClass} value={form.notify_at} onChange={e => set('notify_at', e.target.value)} /></Field>
            {/* ── The message, which nobody writes but the author ───────── */}
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <label htmlFor="session-message" className="text-[13px] font-medium text-[var(--ink-soft)]">
                  The message to send
                </label>
                <span className="text-[12px] tabular-nums text-[var(--ink-faint)]">
                  {segments.characters} characters
                  {segments.segments > 0 && ` · ${segments.segments} SMS`}
                </span>
              </div>
              <textarea
                id="session-message"
                className={textareaClass}
                rows={5}
                placeholder="Write what you want these leads to read."
                value={form.message}
                onChange={e => set('message', e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {PLACEHOLDERS.map(ph => (
                  <button key={ph.token} type="button"
                    onClick={() => set('message', `${form.message}${ph.token}`)}
                    title={ph.label}
                    className="h-11 sm:h-7 px-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] text-[11px] font-mono text-[var(--ink-soft)] hover:border-[var(--accent)] transition">
                    {ph.token}
                  </button>
                ))}
              </div>
              {segments.segments > 1 && (
                <p className="text-[12px] text-[var(--warn)] mt-2 leading-snug">
                  This will be sent as {segments.segments} linked texts, and each one is charged —
                  {' '}{segments.segments} × {audience?.sendable ?? 0} messages in all.
                  {segments.encoding === 'UCS-2' && ' A special character has reduced the limit to 67 per text.'}
                </p>
              )}
              {form.message.trim() && (
                <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--canvas)] p-3">
                  <div className="text-[12px] font-semibold text-[var(--ink-soft)] mb-1">
                    How it reads for the first person on the list
                  </div>
                  <p className="text-[13px] text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{messagePreview}</p>
                </div>
              )}
            </div>

            {/* ── Who it goes to ───────────────────────────────────────── */}
            <div className="border-t border-[var(--line-soft)] pt-4">
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h4 className="text-[13px] font-semibold text-[var(--ink)]">Who should receive it</h4>
                {!isEmptySelection && (
                  <button type="button" onClick={() => setFilter({})}
                    className="text-[12px] text-[var(--accent)] hover:underline">Reset all</button>
                )}
              </div>
              <AudiencePicker filter={filter} onChange={setFilter} />
            </div>

            {/* ── What that comes to ───────────────────────────────────── */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--canvas)] p-3">
              {audienceState === 'error' ? (
                <p className="text-[13px] text-[var(--danger)]">
                  The matching leads could not be counted. Change a filter to try again.
                </p>
              ) : !audience ? (
                <p className="text-[13px] text-[var(--ink-faint)]">Counting the matching leads…</p>
              ) : (
                <>
                  <p className="text-[14px] text-[var(--ink)]">
                    <button type="button" onClick={() => setShowMatching(true)}
                      className="font-semibold text-[var(--accent)] hover:underline tabular-nums">
                      {audience.matching} lead{audience.matching === 1 ? '' : 's'}
                    </button>
                    {' '}match your selection.
                  </p>
                  <dl className="mt-2 space-y-0.5 text-[12px]">
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--ink-faint)]">Can be texted</dt>
                      <dd className="font-semibold text-[var(--ok)] tabular-nums">{audience.sendable}</dd>
                    </div>
                    {audience.excluded > 0 && (
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--ink-faint)]">No usable phone number</dt>
                        <dd className="font-semibold text-[var(--warn)] tabular-nums">{audience.excluded}</dd>
                      </div>
                    )}
                  </dl>
                  {audienceState === 'loading' && (
                    <p className="text-[11px] text-[var(--ink-faint)] mt-1.5">Updating…</p>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-2">Send by</label>
              <div className="flex gap-2">
                {['sms', 'whatsapp', 'email'].map(c => (
                  <button key={c} onClick={() => toggleChannel(c)}
                    className={`flex-1 h-10 rounded-2xl text-[13px] font-semibold border transition ${form.channels.includes(c) ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--paper)] text-[var(--ink-faint)] border-[var(--line)]'}`}>
                    {c === 'sms' ? 'SMS' : c === 'whatsapp' ? 'WhatsApp' : 'Email'}
                  </button>
                ))}
              </div>
            </div>

            {/*
              * Two ways out of this form, because there are two things people
              * come here to do. Scheduling needs an auto-send time; sending
              * now does not, and asking for one was the step that made a
              * three-click job out of pressing Send.
              */}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={() => create(true)} disabled={saving} className="flex-1">
                {saving ? 'Working…' : 'Send now'}
              </Button>
              <Button onClick={() => create(false)} disabled={saving} variant="secondary" className="flex-1">
                {saving ? 'Working…' : 'Schedule for later'}
              </Button>
            </div>
            <p className="text-[12px] text-[var(--ink-faint)] text-center">
              Sending now goes to every targeted lead immediately. Scheduling needs an auto-send time.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
