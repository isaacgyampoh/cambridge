'use client'
import { useState, useEffect, useMemo } from 'react'
import { readableStatus } from '@/lib/ui/status'
import { PageHeader, Card, Button, Field, inputClass, textareaClass, Spinner, EmptyState, Badge } from '@/components/ui'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { postJson, messageFor } from '@/lib/api/post'
import type { Progress } from '@/lib/infoSessionCampaign'

export default function InfoSessions() {
  const { confirm, dialog } = useConfirm()
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', link: '', description: '', scheduled_at: '', notify_at: '', audience: 'all_leads', channels: ['sms', 'whatsapp'] })
  const [preview, setPreview] = useState<any>(null)
  const [attendance, setAttendance] = useState<any[]>([])

  // Live preview: reach count + message, updates as the form changes
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const d = await fetch('/api/info-sessions/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: form.title, link: form.link, description: form.description, scheduled_at: form.scheduled_at, audience: form.audience }),
        }).then(r => r.json())
        setPreview(d)
      } catch {}
    }, 400)
    return () => clearTimeout(t)
  }, [form.title, form.link, form.description, form.scheduled_at, form.audience])

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
    setForm({ title: '', link: '', description: '', scheduled_at: '', notify_at: '', audience: 'all_leads', channels: ['sms', 'whatsapp'] })
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

    if (sendNow && !await confirm({
      title: 'Create and send it now?',
      message: `"${form.title.trim()}" goes to ${preview?.leadCount ?? 'every targeted'} lead${preview?.leadCount === 1 ? '' : 's'}. Sending starts now and continues on its own — it cannot be recalled.`,
      confirmLabel: 'Send now',
      tone: 'accent',
    })) return

    setSaving(true)
    const res = await fetch('/api/info-sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, channels: form.channels.join(','), send_now: sendNow }),
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
                        {s.status === 'sent' && <p className="text-[13px] text-[var(--ok)]">Sent to {s.leads_notified} leads · {s.marketers_notified} marketers notified</p>}
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
                                      <dd className="font-semibold tabular-nums" style={{ color: String(tone) }}>{value}</dd>
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
              <h3 className="font-display text-[15px] font-semibold text-[var(--ink)] mb-3">Who drove attendance</h3>
              <div className="space-y-3">
                {attendance.map((sess: any) => (
                  <Card key={sess.session_id} className="p-5">
                    <div className="flex items-baseline justify-between mb-3">
                      <div className="font-medium text-[var(--ink)] truncate pr-3">{sess.title}</div>
                      <div className="text-[13px] text-[var(--ink-soft)] flex-shrink-0"><span className="font-semibold text-[var(--accent)]">{sess.total}</span> joined</div>
                    </div>
                    <div className="space-y-1.5">
                      {sess.marketers.map((m: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-[13px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-5 text-center text-[11px] font-semibold ${i === 0 ? 'text-[var(--gold)]' : 'text-[var(--ink-faint)]'}`}>{i + 1}</span>
                            <span className={`truncate ${m.name === 'Not attributed' ? 'text-[var(--ink-faint)] italic' : 'text-[var(--ink)]'}`}>{m.name}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="w-24 h-1.5 rounded-full bg-[var(--line-soft)] overflow-hidden">
                              <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round((m.count / sess.total) * 100)}%` }} />
                            </div>
                            <span className="font-medium text-[var(--ink)] w-6 text-right">{m.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
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
            <Field label="Who to notify">
              <select className={inputClass} value={form.audience} onChange={e => set('audience', e.target.value)}>
                <option value="all_leads">All active leads</option>
                <option value="uncontacted">Uncontacted leads only</option>
                <option value="interested">Interested / ready-to-join</option>
              </select>
            </Field>
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
            {/* Live preview */}
            {preview && (
              <div className="rounded-2xl bg-[var(--canvas)] border border-[var(--line)] p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[13px] font-semibold text-[var(--ink)]">Reach</span>
                  <span className="text-[13px] text-[var(--accent)] font-semibold">{preview.leadCount} lead{preview.leadCount === 1 ? '' : 's'}</span>
                </div>
                <p className="text-[12px] text-[var(--ink-faint)] mb-3">
                  {form.channels.includes('email') ? `${preview.withEmail} also have an email. ` : ''}
                  Each lead gets the message by {form.channels.map(c => c === 'sms' ? 'SMS' : c === 'whatsapp' ? 'WhatsApp' : 'email').join(' + ') || '—'}.
                </p>
                <div className="text-[12px] font-semibold text-[var(--ink-soft)] mb-1">Message preview</div>
                <div className="text-[13px] text-[var(--ink-soft)] whitespace-pre-wrap bg-[var(--paper)] rounded-lg p-3 border border-[var(--line-soft)] leading-relaxed">{preview.message}</div>
              </div>
            )}

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
