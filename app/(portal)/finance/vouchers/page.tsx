'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Spinner, EmptyState, Badge, inputClass, Field } from '@/components/ui'
import { toast } from 'sonner'

export default function VoucherRequestsPage() {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [fulfill, setFulfill] = useState<any>(null)
  const [code, setCode] = useState('')
  const [expiry, setExpiry] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const d = await fetch('/api/prep/voucher?scope=finance').then(r => r.json()).catch(() => ({ requests: [] }))
    setRequests(d.requests || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function submitFulfill() {
    if (!code.trim()) { toast.error('Enter the voucher code'); return }
    setSaving(true)
    const d = await fetch('/api/prep/voucher', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fulfill', request_id: fulfill.id, voucher_code: code, voucher_expiry_date: expiry || null }),
    }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setSaving(false)
    if (d.success) {
      toast.success(d.messaged ? 'Voucher input & sent to the student on WhatsApp' : 'Voucher saved (student had no phone)')
      setFulfill(null); setCode(''); setExpiry(''); load()
    } else toast.error(d.error || 'Could not submit')
  }

  const pending = requests.filter(r => r.status === 'pending')
  const done = requests.filter(r => r.status !== 'pending')

  return (
    <div className="fade-in w-full max-w-4xl">
      <PageHeader eyebrow="Finance" title="Voucher requests"
        description="Exam-prep coordinators request vouchers for students who are ready to write. Buy the voucher, then input the code here — it's sent to the student automatically." />

      {loading ? <Spinner /> : (
        <>
          {/* Pending */}
          <div className="mb-6">
            <h3 className="text-[14px] font-semibold text-[var(--ink)] mb-3">Pending requests {pending.length > 0 && <span className="text-[var(--warn)]">({pending.length})</span>}</h3>
            {pending.length === 0 ? (
              <EmptyState title="No pending requests" description="When a coordinator requests a voucher, it appears here." />
            ) : (
              <div className="space-y-3">
                {pending.map(r => (
                  <Card key={r.id} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--ink)]">{r.student_name}</div>
                        <div className="text-[13px] text-[var(--ink-soft)]">{r.program_name || r.program_code} · requested {new Date(r.requested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                      </div>
                      <Button size="sm" onClick={() => { setFulfill(r); setCode(''); setExpiry('') }}>Input voucher</Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Fulfilled / history */}
          {done.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold text-[var(--ink)] mb-3">Recent</h3>
              <div className="space-y-2">
                {done.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-[var(--line-soft)]">
                    <div className="min-w-0">
                      <span className="text-[14px] text-[var(--ink)]">{r.student_name}</span>
                      <span className="text-[13px] text-[var(--ink-faint)]"> · {r.program_name || r.program_code}</span>
                    </div>
                    {r.status === 'fulfilled'
                      ? <Badge tone="success">Sent{r.voucher_code ? ` · ${r.voucher_code}` : ''}</Badge>
                      : <Badge tone="neutral">Cancelled</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Input modal */}
      {fulfill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setFulfill(null)}>
          <div className="bg-[var(--paper)] rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="font-display text-lg font-semibold text-[var(--ink)] mb-1">Input voucher</h2>
            <p className="text-[13px] text-[var(--ink-soft)] mb-4">{fulfill.student_name} · {fulfill.program_name || fulfill.program_code}</p>
            <div className="space-y-4">
              <Field label="Voucher code">
                <input value={code} onChange={e => setCode(e.target.value)} placeholder="Paste the purchased voucher code" className={inputClass} autoFocus />
              </Field>
              <Field label="Expiry date (optional)">
                <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="flex gap-2 mt-6">
              <Button onClick={submitFulfill} disabled={saving}>{saving ? 'Sending…' : 'Save & send to student'}</Button>
              <Button variant="secondary" onClick={() => setFulfill(null)}>Cancel</Button>
            </div>
            <p className="text-[11px] text-[var(--ink-faint)] mt-3">On save, the student is automatically sent their voucher code, expiry, and encouragement on WhatsApp.</p>
          </div>
        </div>
      )}
    </div>
  )
}
