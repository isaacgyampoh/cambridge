'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState } from '@/components/ui'
import { ArrowLeftRight, Check, X, Phone } from 'lucide-react'
import { toast } from 'sonner'

export default function TransfersPage() {
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const d = await fetch('/api/leads/transfer').then(r => r.json()).catch(() => ({ requests: [] }))
    setRequests(d.requests || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function decide(id: string, action: 'approve' | 'decline') {
    setActing(id)
    try {
      const res = await fetch('/api/leads/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, requestId: id }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(action === 'approve' ? 'Approved — lead reassigned' : 'Declined')
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setActing(null) }
  }

  const pending = requests.filter(r => r.status === 'pending')
  const decided = requests.filter(r => r.status !== 'pending')

  return (
    <div className="fade-in w-full max-w-3xl">
      <PageHeader
        eyebrow="Leads"
        title="Transfer requests"
        description="When a marketer reaches a lead owned by someone else, they request it here. You decide who keeps it."
      />

      {loading ? <Spinner /> : (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-3">Pending ({pending.length})</p>
          {pending.length === 0 ? (
            <EmptyState icon={<ArrowLeftRight size={20} />} title="No pending requests" description="Transfer requests from marketers will appear here." />
          ) : (
            <div className="space-y-3 mb-8">
              {pending.map(r => (
                <Card key={r.id} className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="font-semibold text-[var(--ink)]">{r.lead?.full_name || 'Lead'}</div>
                      <div className="text-xs text-[var(--ink-soft)] flex items-center gap-2 mt-0.5">
                        {r.lead?.phone && <span className="flex items-center gap-1"><Phone size={11} /> {String(r.lead.phone).replace(/^233/, '0')}</span>}
                        {r.lead?.course_interest && <span>· {r.lead.course_interest}</span>}
                      </div>
                    </div>
                    <Badge tone="warning">Pending</Badge>
                  </div>
                  <div className="rounded-xl bg-[var(--canvas)] p-3 text-sm mb-3">
                    <div className="flex items-center gap-2 text-[var(--ink-soft)] mb-1">
                      <span className="font-medium text-[var(--ink)]">{r.requester?.full_name || 'A marketer'}</span>
                      <ArrowLeftRight size={13} />
                      <span>currently {r.owner?.full_name || 'unassigned'}</span>
                    </div>
                    {r.reason && <p className="text-[var(--ink-soft)] mt-1.5">"{r.reason}"</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={acting === r.id} onClick={() => decide(r.id, 'approve')} icon={<Check size={14} />}>Approve transfer</Button>
                    <Button size="sm" variant="secondary" disabled={acting === r.id} onClick={() => decide(r.id, 'decline')} icon={<X size={14} />}>Decline</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {decided.length > 0 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-3">Decided</p>
              <div className="space-y-2">
                {decided.slice(0, 20).map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--line)] bg-[var(--paper)]">
                    <div className="text-sm">
                      <span className="font-medium text-[var(--ink)]">{r.lead?.full_name}</span>
                      <span className="text-[var(--ink-faint)]"> · {r.requester?.full_name}</span>
                    </div>
                    <Badge tone={r.status === 'approved' ? 'success' : 'neutral'}>{r.status}</Badge>
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
