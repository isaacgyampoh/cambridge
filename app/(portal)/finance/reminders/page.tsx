'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Field, textareaClass, Spinner } from '@/components/ui'
import { toast } from 'sonner'

export default function PaymentReminders() {
  const [preview, setPreview] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [channels, setChannels] = useState<string[]>(['sms', 'whatsapp'])
  const [note, setNote] = useState('')

  async function loadPreview() {
    try {
      const d = await fetch('/api/payment-reminders/preview').then(r => r.json())
      setPreview(d)
    } catch {}
    setLoading(false)
  }
  useEffect(() => { loadPreview() }, [])

  function toggle(c: string) {
    setChannels(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c])
  }

  async function send() {
    if (channels.length === 0) { toast.error('Pick at least one channel.'); return }
    if (!confirm(`Send a payment reminder to all ${preview?.owingCount ?? ''} students who owe?`)) return
    setSending(true)
    toast.loading('Sending…', { id: 'pr' })
    const d = await fetch('/api/payment-reminders/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels: channels.join(','), note }),
    }).then(r => r.json())
    setSending(false)
    if (d.success) toast.success(`Sent to ${d.students_notified} of ${d.total_owing} students`, { id: 'pr' })
    else toast.error(d.error || 'Could not send', { id: 'pr' })
  }

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Automation" title="Payment reminders"
        description="Send every student who owes a friendly reminder with their outstanding balance and a pay link. Review who it reaches before sending." />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        {/* Who owes */}
        <Card className="p-6">
          <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-1">Outstanding balances</h3>
          <p className="text-[13px] text-[var(--ink-soft)] mb-4">Students with an unpaid balance right now.</p>
          {loading ? <Spinner /> : (
            <>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="font-display text-[32px] font-semibold text-[var(--ink)]">{preview?.owingCount ?? 0}</span>
                <span className="text-[14px] text-[var(--ink-soft)]">students owe GHS {(preview?.totalOwed ?? 0).toLocaleString()}</span>
              </div>
              {preview?.sample?.length > 0 ? (
                <div className="space-y-1.5">
                  {preview.sample.map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--line-soft)] last:border-0">
                      <span className="text-[14px] text-[var(--ink)]">{s.name}</span>
                      <span className="text-[14px] font-semibold text-[var(--danger)]">GHS {Number(s.balance).toFixed(2)}</span>
                    </div>
                  ))}
                  {preview.owingCount > preview.sample.length && (
                    <p className="text-[13px] text-[var(--ink-faint)] pt-2">+ {preview.owingCount - preview.sample.length} more</p>
                  )}
                </div>
              ) : <p className="text-[14px] text-[var(--ink-soft)]">No outstanding balances. Everyone's paid up.</p>}
            </>
          )}
        </Card>

        {/* Send panel */}
        <Card className="p-6">
          <h3 className="font-display text-[16px] font-semibold text-[var(--ink)] mb-4">Send reminders</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-2">Send by</label>
              <div className="flex gap-2">
                {['sms', 'whatsapp'].map(c => (
                  <button key={c} onClick={() => toggle(c)}
                    className={`flex-1 h-10 rounded-xl text-[13px] font-semibold border transition ${channels.includes(c) ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--paper)] text-[var(--ink-faint)] border-[var(--line)]'}`}>
                    {c === 'sms' ? 'SMS' : 'WhatsApp'}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Add a note (optional)">
              <textarea className={textareaClass} rows={2} placeholder="Kindly settle before Friday to keep your place." value={note} onChange={e => setNote(e.target.value)} />
            </Field>
            <div className="rounded-xl bg-[var(--canvas)] border border-[var(--line)] p-3 text-[12px] text-[var(--ink-soft)] leading-relaxed">
              Each student gets: their name, outstanding balance, your note, and a personal pay link.
            </div>
            <Button onClick={send} disabled={sending || (preview?.owingCount ?? 0) === 0} className="w-full">
              {sending ? 'Sending…' : `Send to ${preview?.owingCount ?? 0} students`}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
