'use client'
import { useState, useEffect } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass, StatCard } from '@/components/ui'
import Modal from '@/components/shared/Modal'
import { Wallet, Search, Check, X, ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'

export default function StudentFeesPage() {
  const { data: fees, loading, refetch } = useData<any>({ table: 'student_fees', select: '*', orderBy: 'created_at', orderAsc: false, limit: 1000 })
  const [pending, setPending] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'students' | 'pending'>('students')
  const [acting, setActing] = useState<string | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [recordFor, setRecordFor] = useState<any>(null)
  const [recordAmt, setRecordAmt] = useState('')

  async function loadPending() {
    const d = await fetch('/api/fees/verify').then(r => r.json()).catch(() => ({ payments: [] }))
    setPending((d.payments || []).filter((p: any) => p.status === 'pending'))
  }
  useEffect(() => { loadPending() }, [])

  async function decide(p: any, action: 'verify' | 'reject') {
    setActing(p.id)
    try {
      const amount = action === 'verify' ? Number(amounts[p.id] ?? p.amount) : undefined
      const res = await fetch('/api/fees/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: p.id, action, amount }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      toast.success(action === 'verify' ? 'Verified — student notified with receipt' : 'Rejected')
      loadPending(); refetch()
    } catch (e: any) { toast.error(e.message) }
    finally { setActing(null) }
  }

  // Finance manually records a payment for a student (e.g. cash at desk)
  async function recordPayment() {
    if (!recordFor || !(Number(recordAmt) > 0)) { toast.error('Enter an amount'); return }
    setActing(recordFor.id)
    try {
      // Record as a verified cash payment directly
      const payRes = await fetch('/api/fees/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentFeeId: recordFor.id, amount: Number(recordAmt), method: 'cash' }),
      }).then(r => r.json())
      if (payRes.error) throw new Error(payRes.error)
      // The cash payment is pending; immediately verify it (finance is recording it themselves)
      await loadPending()
      toast.success('Payment recorded — now verify it below')
      setRecordFor(null); setRecordAmt(''); refetch(); setTab('pending')
    } catch (e: any) { toast.error(e.message) }
    finally { setActing(null) }
  }

  const filtered = (fees || []).filter((f: any) => !search || (f.student_name || '').toLowerCase().includes(search.toLowerCase()))
  const totalOwing = (fees || []).reduce((s: number, f: any) => s + (Number(f.balance) || 0), 0)
  const totalCollected = (fees || []).reduce((s: number, f: any) => s + (Number(f.amount_paid) || 0), 0)

  return (
    <div className="fade-in w-full">
      <PageHeader eyebrow="Finance" title="Student fees" description="Every registered student and what they owe. Verify bank and cash payments here." />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Students" value={String((fees || []).length)} />
        <StatCard label="Collected" value={`GHS ${totalCollected.toFixed(0)}`} />
        <StatCard label="Outstanding" value={`GHS ${totalOwing.toFixed(0)}`} />
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('students')} className={`text-sm font-medium px-4 h-9 rounded-lg ${tab === 'students' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>All students</button>
        <button onClick={() => setTab('pending')} className={`text-sm font-medium px-4 h-9 rounded-lg ${tab === 'pending' ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>
          To verify {pending.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-400 text-white text-[10px]">{pending.length}</span>}
        </button>
      </div>

      {tab === 'students' ? (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-[var(--line)]">
            <div className="relative max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…" className={inputClass + ' pl-9'} />
            </div>
          </div>
          {loading ? <div className="p-8"><Spinner /></div> : filtered.length === 0 ? (
            <EmptyState icon={<Wallet size={20} />} title="No registered students yet" description="Students appear here automatically once they register." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-[var(--line)]">
                  {['Student', 'Course', 'Total', 'Paid', 'Balance', 'Status', ''].map(h => <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>)}
                </tr></thead>
                <tbody>
                  {filtered.map((f: any) => (
                    <tr key={f.id} className="border-b border-[var(--line-soft)] last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--ink)]">{f.student_name}</div>
                        <div className="text-[12px] text-[var(--ink-faint)]">{f.delivery === 'online' ? 'Online' : 'In person'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{f.course_name || '—'}</td>
                      <td className="px-4 py-3 text-sm">GHS {Number(f.total_fee).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-[var(--ok)]">GHS {Number(f.amount_paid).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--warn)]">GHS {Number(f.balance).toFixed(2)}</td>
                      <td className="px-4 py-3"><Badge tone={f.status === 'paid' ? 'success' : f.status === 'partial' ? 'warning' : 'neutral'}>{f.status}</Badge></td>
                      <td className="px-4 py-3">
                        {f.status !== 'paid' && <Button size="sm" variant="secondary" onClick={() => { setRecordFor(f); setRecordAmt(String(f.balance)) }}>Record payment</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        pending.length === 0 ? (
          <EmptyState icon={<Check size={20} />} title="Nothing to verify" description="Bank and cash payments awaiting your confirmation will appear here." />
        ) : (
          <div className="space-y-3">
            {pending.map(p => (
              <Card key={p.id} className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold text-[var(--ink)]">{p.fee?.student_name || p.student_name}</div>
                    <div className="text-xs text-[var(--ink-soft)] mt-0.5">{p.fee?.course_name} · {p.method?.toUpperCase()} · Receipt {p.receipt_no}</div>
                  </div>
                  <Badge tone="warning">Pending</Badge>
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <div className="text-sm"><span className="text-[var(--ink-faint)]">Claimed: </span><span className="font-semibold">GHS {Number(p.amount).toFixed(2)}</span></div>
                  {p.fee && <div className="text-sm text-[var(--ink-faint)]">Balance: GHS {Number(p.fee.balance ?? 0).toFixed(2)}</div>}
                  {p.screenshot_url && <a href={p.screenshot_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] font-medium ml-auto"><ExternalLink size={13} /> Screenshot</a>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--ink-faint)]">Confirm GHS</span>
                    <input value={amounts[p.id] ?? String(p.amount)} onChange={e => setAmounts(a => ({ ...a, [p.id]: e.target.value }))} type="number" className={inputClass + ' w-24 h-9'} />
                  </div>
                  <Button size="sm" disabled={acting === p.id} onClick={() => decide(p, 'verify')} icon={<Check size={14} />}>Verify</Button>
                  <Button size="sm" variant="secondary" disabled={acting === p.id} onClick={() => decide(p, 'reject')} icon={<X size={14} />}>Reject</Button>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      <Modal open={!!recordFor} onClose={() => setRecordFor(null)} maxWidth="max-w-sm">
        {recordFor && (
          <div className="p-6">
            <h2 className="font-display text-lg font-semibold text-[var(--ink)] mb-1">Record a payment</h2>
            <p className="text-sm text-[var(--ink-soft)] mb-4">{recordFor.student_name} · balance GHS {Number(recordFor.balance).toFixed(2)}</p>
            <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase mb-1.5">Amount received</label>
            <input value={recordAmt} onChange={e => setRecordAmt(e.target.value)} type="number" className={inputClass + ' mb-4'} />
            <div className="flex gap-2">
              <Button onClick={recordPayment} disabled={acting === recordFor.id}>Record</Button>
              <Button variant="secondary" onClick={() => setRecordFor(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
