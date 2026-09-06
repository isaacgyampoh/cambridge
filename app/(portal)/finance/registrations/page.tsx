'use client'
import { useState, useEffect } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { PageHeader, Card, StatCard, Spinner, Badge, SectionLabel, EmptyState, inputClass } from '@/components/ui'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { formatGHS, formatDateTime } from '@/lib/utils'
import { exportToExcel } from '@/lib/utils/export'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'

type Registration = {
  id: string
  studentName: string
  studentPhone?: string | null
  program: string
  delivery?: string | null
  registrationFee: number
  marketerName: string
  commissionPaid: boolean
  registeredAt: string
}

export default function FinanceRegistrations() {
  const { confirm, dialog } = useConfirm()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [marketerFilter, setMarketerFilter] = useState('all')
  const [payingId, setPayingId] = useState<string | null>(null)

  async function load() {
    const d = await fetch('/api/registrations').then(r => r.json())
    setData(d); setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function markPaid(marketerId: string, name: string, amount: number) {
    if (!await confirm({
      title: `Mark ${name}\u2019s commission as paid?`,
      message: `Confirms you have paid ${formatGHS(amount)}. Every outstanding registration of theirs is marked paid, and this cannot be undone from here.`,
      confirmLabel: 'Confirm payment',
      tone: 'accent',
    })) return
    setPayingId(marketerId)
    try {
      const res = await fetch('/api/registrations/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketerId }),
      })
      const r = await res.json()
      if (!res.ok) { toast.error(r.error || 'Could not mark paid'); return }
      toast.success(`Marked ${formatGHS(r.amount)} paid to ${name.split(' ')[0]}`)
      load()
    } catch (e: any) { toast.error(e.message) }
    finally { setPayingId(null) }
  }

  if (loading || !data) return <Spinner />

  let rows = data.registrations as any[]
  if (marketerFilter !== 'all') rows = rows.filter(r => r.marketerId === marketerFilter)
  if (search) rows = rows.filter(r => [r.studentName, r.studentPhone, r.program, r.marketerName].some(v => v?.toLowerCase().includes(search.toLowerCase())))

  async function exportRows() {
    await exportToExcel(rows.map(r => ({
      Student: r.studentName, Phone: displayPhone(r.studentPhone) || '',
      Programme: r.program, Delivery: r.delivery?.replace('_', ' '),
      'Registration fee': r.registrationFee, 'Assigned to': r.marketerName,
      Registered: formatDateTime(r.registeredAt),
    })), `registrations-${data.year}`, 'Registrations')
  }

  // Seven columns of money and attribution, unreadable on a phone as a grid.
  const registrationColumns: Column<Registration>[] = [
    { key: 'student', header: 'Student', primary: true, render: r => r.studentName },
    {
      key: 'phone', header: 'Phone', secondary: true,
      render: r => displayPhone(r.studentPhone) || '—',
    },
    { key: 'programme', header: 'Programme', render: r => r.program },
    {
      key: 'delivery', header: 'Class',
      render: r => <Badge tone="neutral">{r.delivery?.replace('_', ' ') || '—'}</Badge>,
    },
    {
      key: 'fee', header: 'Fee', numeric: true,
      render: r => <span className="font-semibold text-[var(--ink)]">{formatGHS(r.registrationFee)}</span>,
    },
    { key: 'marketer', header: 'Assigned to', render: r => <Badge tone="accent">{r.marketerName}</Badge> },
    {
      key: 'commission', header: 'Commission',
      render: r => r.commissionPaid
        ? <Badge tone="success">Paid</Badge>
        : <Badge tone="warning">Owing</Badge>,
    },
    {
      key: 'registered', header: 'Registered',
      render: r => <span className="text-[var(--ink-faint)] text-[12px]">{formatDateTime(r.registeredAt)}</span>,
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {dialog}
      <PageHeader
        eyebrow="Finance"
        title="Registered students"
        description="Every student who has registered and paid, grouped by the marketer who brought them — so you know whose registration commission is whose."
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard label="Registered students" value={data.totals.students}  accent />
        <StatCard label="Total registration fees" value={formatGHS(data.totals.commission)} sub="GHS 200 each"  />
        <StatCard label="Marketers earning" value={data.byMarketer.length}  />
      </div>

      {/* Commission by marketer — whose money is whose */}
      <SectionLabel>Registration commission by marketer</SectionLabel>
      {data.byMarketer.length === 0 ? (
        <EmptyState  title="No registrations yet" description="Registered students will appear here grouped by their marketer." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
          {data.byMarketer.map((m: any) => (
            <div key={m.id}
              className={`rounded-2xl border p-4 transition ${marketerFilter === m.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--paper)]'}`}>
              <button onClick={() => setMarketerFilter(marketerFilter === m.id ? 'all' : m.id)} className="w-full text-left">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-[var(--ink)]">{m.name}</div>
                  <Badge tone="success">{m.count} student{m.count === 1 ? '' : 's'}</Badge>
                </div>
                <div className="font-display text-2xl font-semibold text-[var(--ink)] mt-2">{formatGHS(m.commission)}</div>
                <div className="text-xs text-[var(--ink-faint)] mt-0.5">{m.points} points earned</div>
              </button>
              <div className="mt-3 pt-3 border-t border-[var(--line-soft)] flex items-center justify-between">
                {m.unpaidCommission > 0 ? (
                  <>
                    <div className="text-xs">
                      <span className="text-[var(--ink-faint)]">Outstanding: </span>
                      <span className="font-semibold text-[var(--ink)]">{formatGHS(m.unpaidCommission)}</span>
                    </div>
                    <button onClick={() => markPaid(m.id, m.name, m.unpaidCommission)} disabled={payingId === m.id}
                      className="inline-flex items-center gap-1 h-11 sm:h-7 px-2.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:brightness-110 disabled:opacity-50 transition">
                       {payingId === m.id ? 'Saving…' : 'Mark paid'}
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-[var(--ok)] font-medium"> All paid out</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All registrations */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <SectionLabel>{marketerFilter === 'all' ? 'All registrations' : `${data.byMarketer.find((m: any) => m.id === marketerFilter)?.name}'s registrations`}</SectionLabel>
        <div className="flex gap-2">
          <div className="relative">
            
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" className={inputClass.replace('h-11', 'h-9') + ' pl-9 w-44'} />
          </div>
          <button onClick={exportRows} className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--ink-soft)] hover:border-[var(--ink-faint)] transition">
             Excel
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <DataTable<Registration>
          caption="Registrations and commission"
          rows={rows}
          rowKey={r => r.id}
          columns={registrationColumns}
          emptyTitle="No registrations"
          emptyMessage="Nothing matches your filter."
        />
      </Card>
    </div>
  )
}
