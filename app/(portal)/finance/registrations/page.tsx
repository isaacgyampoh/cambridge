'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, StatCard, Spinner, Badge, SectionLabel, EmptyState, inputClass } from '@/components/ui'
import { formatGHS, formatDateTime } from '@/lib/utils'
import { Wallet, Users, GraduationCap, Search, Download } from 'lucide-react'
import { exportToExcel } from '@/lib/utils/export'

export default function FinanceRegistrations() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [marketerFilter, setMarketerFilter] = useState('all')

  useEffect(() => {
    fetch('/api/registrations').then(r => r.json()).then(d => { setData(d); setLoading(false) })
  }, [])

  if (loading || !data) return <Spinner />

  let rows = data.registrations as any[]
  if (marketerFilter !== 'all') rows = rows.filter(r => r.marketerId === marketerFilter)
  if (search) rows = rows.filter(r => [r.studentName, r.studentPhone, r.program, r.marketerName].some(v => v?.toLowerCase().includes(search.toLowerCase())))

  function exportRows() {
    exportToExcel(rows.map(r => ({
      Student: r.studentName, Phone: r.studentPhone?.replace(/^233/, '0') || '',
      Programme: r.program, Delivery: r.delivery?.replace('_', ' '),
      'Registration fee': r.registrationFee, 'Assigned to': r.marketerName,
      Registered: formatDateTime(r.registeredAt),
    })), `registrations-${data.year}`, 'Registrations')
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Finance"
        title="Registered students"
        description="Every student who has registered and paid, grouped by the marketer who brought them — so you know whose registration commission is whose."
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard label="Registered students" value={data.totals.students} icon={<GraduationCap size={18} />} accent />
        <StatCard label="Total registration fees" value={formatGHS(data.totals.commission)} sub="GHS 200 each" icon={<Wallet size={18} />} />
        <StatCard label="Marketers earning" value={data.byMarketer.length} icon={<Users size={18} />} />
      </div>

      {/* Commission by marketer — whose money is whose */}
      <SectionLabel>Registration commission by marketer</SectionLabel>
      {data.byMarketer.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title="No registrations yet" description="Registered students will appear here grouped by their marketer." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
          {data.byMarketer.map((m: any) => (
            <button key={m.id} onClick={() => setMarketerFilter(marketerFilter === m.id ? 'all' : m.id)}
              className={`text-left rounded-xl border p-4 transition ${marketerFilter === m.id ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--paper)] hover:border-[var(--ink-faint)]'}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium text-[var(--ink)]">{m.name}</div>
                <Badge tone="success">{m.count} student{m.count === 1 ? '' : 's'}</Badge>
              </div>
              <div className="font-display text-2xl font-semibold text-[var(--ink)] mt-2">{formatGHS(m.commission)}</div>
              <div className="text-xs text-[var(--ink-faint)] mt-0.5">to pay this marketer · {m.points} points earned</div>
            </button>
          ))}
        </div>
      )}

      {/* All registrations */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <SectionLabel>{marketerFilter === 'all' ? 'All registrations' : `${data.byMarketer.find((m: any) => m.id === marketerFilter)?.name}'s registrations`}</SectionLabel>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" className={inputClass.replace('h-11', 'h-9') + ' pl-9 w-44'} />
          </div>
          <button onClick={exportRows} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--ink-soft)] hover:border-[var(--ink-faint)] transition">
            <Download size={14} /> Excel
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-12"><EmptyState icon={<GraduationCap size={20} />} title="No registrations" description="Nothing matches your filter." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-[var(--line)]">
                {['Student', 'Programme', 'Delivery', 'Fee', 'Assigned to', 'Registered'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)]">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-[var(--ink)]">{r.studentName}</div>
                      <div className="text-[11px] text-[var(--ink-faint)]">{r.studentPhone?.replace(/^233/, '0')}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{r.program}</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{r.delivery?.replace('_', ' ')}</Badge></td>
                    <td className="px-4 py-3 text-sm font-semibold text-[var(--ink)]">{formatGHS(r.registrationFee)}</td>
                    <td className="px-4 py-3"><Badge tone="accent">{r.marketerName}</Badge></td>
                    <td className="px-4 py-3 text-[11px] text-[var(--ink-faint)]">{formatDateTime(r.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
