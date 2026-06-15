'use client'
import { useData, mutate } from '@/hooks/useData'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { UserCheck, Phone, Mail } from 'lucide-react'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState } from '@/components/ui'

const S: Record<string, { label: string; tone: any }> = {
  pending: { label: 'Pending', tone: 'warning' },
  awaiting_forms: { label: 'Awaiting forms', tone: 'accent' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'warning' },
  admitted: { label: 'Admitted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

export default function AdminAdmissions() {
  const [filter, setFilter] = useState('all')
  const [acting, setActing] = useState<string | null>(null)
  const { data, loading, refetch } = useData<any>({
    table: 'admissions',
    select: '*, lead:lead_id(full_name,phone,email,course_interest,assigned_to,assignee:assigned_to(full_name)), course:course_id(name)',
    orderBy: 'created_at', orderAsc: false, limit: 300,
  })

  async function updateStatus(id: string, status: string) {
    setActing(id)
    try {
      await mutate('PATCH', 'admissions', { status }, [{ col: 'id', val: id }])
      toast.success('Status updated')
      refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setActing(null) }
  }

  async function setScholarship(id: string, type: string | null) {
    setActing(id)
    try {
      await mutate('PATCH', 'admissions', {
        scholarship_type: type,
        scholarship_decided: !!type,
      }, [{ col: 'id', val: id }])
      toast.success(type ? `${type === 'full' ? 'Full' : 'Partial'} scholarship granted` : 'Scholarship cleared')
      refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setActing(null) }
  }

  const counts = data.reduce((acc: any, a: any) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc }, {})
  const filtered = filter === 'all' ? data : data.filter((a: any) => a.status === filter)
  const tabs = [{ k: 'all', l: `All (${data.length})` }, ...Object.keys(S).map(k => ({ k, l: `${S[k].label} (${counts[k] || 0})` }))]

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Admissions"
        title="Admissions queue"
        description="Process students from ready-to-join through to admitted."
      />

      <div className="flex gap-1 mb-5 bg-[var(--line-soft)] rounded-lg p-1 w-fit overflow-x-auto max-w-full">
        {tabs.map(t => (
          <button key={t.k} onClick={() => setFilter(t.k)}
            className={`px-3 h-8 rounded-md text-[13px] font-medium whitespace-nowrap transition ${filter === t.k ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState icon={<UserCheck size={20} />} title="Nothing here" description="No admissions in this category yet." />
      ) : (
        <div className="space-y-3 stagger">
          {filtered.map((a: any) => {
            const lead = a.lead; const sc = S[a.status] || S.pending
            return (
              <Card key={a.id} className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] font-semibold flex-shrink-0">
                      {lead?.full_name?.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--ink)]">{lead?.full_name || 'Unknown'}</div>
                      <div className="text-sm text-[var(--ink-soft)]">{a.course?.name || lead?.course_interest || 'No course set'}</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[var(--ink-faint)]">
                        {lead?.phone && <span className="flex items-center gap-1.5"><Phone size={12} />{lead.phone.replace(/^233/, '0')}</span>}
                        {lead?.email && <span className="flex items-center gap-1.5"><Mail size={12} />{lead.email}</span>}
                        <span>{formatDateTime(a.created_at)}</span>
                        {lead?.assignee?.full_name && <span className="flex items-center gap-1.5 text-[var(--accent)] font-medium">Registered by {lead.assignee.full_name.split(' ')[0]}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={sc.tone}>{sc.label}</Badge>
                    {a.status === 'pending' && (
                      <>
                        <Button size="sm" variant="secondary" disabled={acting === a.id} onClick={() => updateStatus(a.id, 'awaiting_forms')}>Request forms</Button>
                        <Button size="sm" variant="secondary" disabled={acting === a.id} onClick={() => updateStatus(a.id, 'awaiting_payment')}>Awaiting payment</Button>
                      </>
                    )}
                    {['awaiting_forms', 'awaiting_payment'].includes(a.status) && (
                      <Button size="sm" disabled={acting === a.id} onClick={() => updateStatus(a.id, 'admitted')}>Admit</Button>
                    )}
                    {!['rejected', 'admitted'].includes(a.status) && (
                      <Button size="sm" variant="danger" disabled={acting === a.id} onClick={() => updateStatus(a.id, 'rejected')}>Reject</Button>
                    )}
                    {/* Scholarship decision — admission's call */}
                    {a.scholarship_type ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone="accent">{a.scholarship_type === 'full' ? 'Full scholarship' : 'Partial scholarship'}</Badge>
                        <button disabled={acting === a.id} onClick={() => setScholarship(a.id, null)}
                          className="text-[11px] text-[var(--ink-faint)] hover:text-[var(--ink)] underline">clear</button>
                      </span>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <span className="text-[11px] text-[var(--ink-faint)]">Scholarship:</span>
                        <button disabled={acting === a.id} onClick={() => setScholarship(a.id, 'full')}
                          className="text-[11px] font-medium px-2 py-1 rounded-md border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition">Full</button>
                        <button disabled={acting === a.id} onClick={() => setScholarship(a.id, 'partial')}
                          className="text-[11px] font-medium px-2 py-1 rounded-md border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition">Partial</button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
