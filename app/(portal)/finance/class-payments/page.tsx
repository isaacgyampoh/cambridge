'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import { Banknote, Check, X, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

export default function ClassPaymentsPage() {
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    const d = await fetch('/api/classes/verify-payment').then(r => r.json()).catch(() => ({ payments: [] }))
    setPayments(d.payments || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function decide(p: any, action: 'verify' | 'reject') {
    setActing(p.id)
    try {
      const amount = action === 'verify' ? Number(amounts[p.id] ?? p.amount) : undefined
      const res = await fetch('/api/classes/verify-payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: p.id, action, amount }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(action === 'verify' ? 'Verified — student notified' : 'Rejected')
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setActing(null) }
  }

  const pending = payments.filter(p => p.status === 'pending')
  const decided = payments.filter(p => p.status !== 'pending')

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Finance" title="Class payments" description="Verify bank transfers and cash payments made at class sign-in. Confirm the amount (full or partial) and the student is notified with an invoice." />

      {loading ? <Spinner /> : (
        <>
          <p className="text-[13px] font-medium text-[var(--ink-faint)] mb-3">Pending ({pending.length})</p>
          {pending.length === 0 ? (
            <EmptyState  title="Nothing to verify" description="Bank and cash payments from sign-in will appear here." />
          ) : (
            <div className="space-y-3 mb-8">
              {pending.map(p => (
                <Card key={p.id} className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="font-semibold text-[var(--ink)]">{p.enrollment?.full_name || p.student_name}</div>
                      <div className="text-xs text-[var(--ink-soft)] mt-0.5">{p.batch?.name} · {p.method?.toUpperCase()} · Invoice {p.invoice_no}</div>
                    </div>
                    <Badge tone="warning">Pending</Badge>
                  </div>
                  <div className="flex items-center gap-4 mb-3">
                    <div className="text-sm">
                      <span className="text-[var(--ink-faint)]">Claimed: </span>
                      <span className="font-semibold text-[var(--ink)]">GHS {Number(p.amount).toFixed(2)}</span>
                    </div>
                    {p.enrollment && (
                      <div className="text-sm text-[var(--ink-faint)]">Balance: GHS {Number(p.enrollment.balance ?? 0).toFixed(2)}</div>
                    )}
                    {p.screenshot_url && (
                      <a href={p.screenshot_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] font-medium ml-auto">
                         View screenshot
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-[var(--ink-faint)]">Confirm GHS</span>
                      <input value={amounts[p.id] ?? String(p.amount)} onChange={e => setAmounts(a => ({ ...a, [p.id]: e.target.value }))}
                        type="number" className={inputClass + ' w-24 h-9'} />
                    </div>
                    <Button size="sm" disabled={acting === p.id} onClick={() => decide(p, 'verify')} >Verify</Button>
                    <Button size="sm" variant="secondary" disabled={acting === p.id} onClick={() => decide(p, 'reject')} >Reject</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {decided.length > 0 && (
            <>
              <p className="text-[13px] font-medium text-[var(--ink-faint)] mb-3">Recent</p>
              <div className="space-y-2">
                {decided.slice(0, 30).map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--line)] bg-[var(--paper)]">
                    <div className="text-sm">
                      <span className="font-medium text-[var(--ink)]">{p.enrollment?.full_name || p.student_name}</span>
                      <span className="text-[var(--ink-faint)]"> · GHS {Number(p.amount).toFixed(2)} · {p.method?.toUpperCase()}</span>
                    </div>
                    <Badge tone={p.status === 'verified' ? 'success' : 'neutral'}>{p.status}</Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
