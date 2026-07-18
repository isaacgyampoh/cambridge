'use client'
import { useState } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { formatGHS, formatDateTime } from '@/lib/utils'
import { DollarSign, TrendingUp, AlertCircle, Plus, RefreshCw, X, Receipt, FileText } from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/shared/Modal'
import { PageHeader, Card, Button, Badge, StatCard, Spinner, EmptyState, Field, inputClass } from '@/components/ui'

const METHOD_TONE: Record<string, any> = {
  cash: 'success', paystack: 'accent', bank_transfer: 'neutral', mobile_money: 'warning',
}

export default function FinancePage() {
  const [tab, setTab] = useState<'payments' | 'invoices'>('payments')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ student_id: '', amount: '', method: 'cash', notes: '' })
  const [saving, setSaving] = useState(false)

  const { data: payments, loading: loadP, refetch: refetchP } = useData<any>({
    table: 'payments', select: '*, student:student_id(full_name, phone)', orderBy: 'created_at', orderAsc: false, limit: 200,
  })
  const { data: invoices, loading: loadI, refetch: refetchI } = useData<any>({
    table: 'invoices', select: '*, student:student_id(full_name)', orderBy: 'created_at', orderAsc: false, limit: 200,
  })
  const { data: students } = useData<any>({
    table: 'profiles', select: 'id, full_name, phone',
    filters: [{ col: 'role', op: 'eq', val: 'student' }, { col: 'is_active', op: 'eq', val: true }],
    orderBy: 'full_name', limit: 500,
  })

  const loading = loadP || loadI
  const paidPayments = payments.filter((p: any) => p.status === 'paid')
  const totalRevenue = paidPayments.reduce((a: number, p: any) => a + Number(p.amount), 0)
  const outstanding = invoices.reduce((a: number, i: any) => a + Number(i.outstanding || 0), 0)
  const todayRev = paidPayments
    .filter((p: any) => p.paid_at?.startsWith(new Date().toISOString().slice(0, 10)))
    .reduce((a: number, p: any) => a + Number(p.amount), 0)

  async function recordPayment() {
    if (!form.student_id || !form.amount) { toast.error('Select a student and enter an amount'); return }
    setSaving(true)
    try {
      await mutate('POST', 'payments', {
        student_id: form.student_id, amount: parseFloat(form.amount), method: form.method,
        status: 'paid', notes: form.notes || null, paid_at: new Date().toISOString(),
      })
      toast.success('Payment recorded')
      setShowModal(false)
      setForm({ student_id: '', amount: '', method: 'cash', notes: '' })
      refetchP()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Finance"
        title="Payments & invoices"
        description="Record payments, track invoices and monitor revenue."
        actions={
          <>
            <Button variant="secondary" href="/finance/reports">Reports</Button>
            <Button variant="secondary" onClick={async () => {
              const ref = prompt('Paste the Paystack reference of a payment that did not register (or leave blank to auto-scan recent payments):')
              if (ref === null) return
              toast.loading('Checking Paystack…', { id: 'rec' })
              const d = await fetch('/api/paystack/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ref.trim() ? { reference: ref.trim() } : {}) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
              if (d.error) toast.error(d.error, { id: 'rec' })
              else toast.success(`Fixed ${d.fixed || 0} payment(s). ${d.swept ? `Scanned ${d.swept}.` : ''}`.trim(), { id: 'rec' })
              refetchP?.()
            }}>Fix stuck payment</Button>
            <Button variant="secondary" href="/finance/reminders">Payment reminders</Button>
            <Button variant="secondary" href="/finance/invoices/new" >Invoice</Button>
            <Button onClick={() => setShowModal(true)} >Record payment</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total revenue" value={formatGHS(totalRevenue)} sub="collected to date"  accent />
        <StatCard label="Today" value={formatGHS(todayRev)}  />
        <StatCard label="Transactions" value={paidPayments.length} sub="paid"  />
        <StatCard label="Outstanding" value={formatGHS(outstanding)} sub={outstanding > 0 ? 'across invoices' : 'all settled'}  />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} maxWidth="max-w-sm">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">Record payment</h2>
            <button onClick={() => setShowModal(false)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
          </div>
          <div className="space-y-4">
            <Field label="Student" required>
              <select value={form.student_id} onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))} className={inputClass}>
                <option value="">Select student</option>
                {students.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </Field>
            <Field label="Amount (GHS)" required>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className={inputClass} />
            </Field>
            <Field label="Method">
              <div className="grid grid-cols-2 gap-2">
                {[{ v: 'cash', l: 'Cash' }, { v: 'mobile_money', l: 'Mobile money' }, { v: 'bank_transfer', l: 'Bank' }, { v: 'paystack', l: 'Card' }].map(m => (
                  <button key={m.v} type="button" onClick={() => setForm(f => ({ ...f, method: m.v }))}
                    className={`h-10 rounded-lg text-sm font-medium border transition ${form.method === m.v ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)]'}`}>
                    {m.l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Notes">
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" className={inputClass} />
            </Field>
          </div>
          <div className="flex gap-2 mt-6">
            <Button onClick={recordPayment} disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Record payment'}</Button>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-[var(--line-soft)] rounded-lg p-1 w-fit">
        {[{ k: 'payments', l: `Payments (${payments.length})` }, { k: 'invoices', l: `Invoices (${invoices.length})` }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            className={`px-4 h-8 rounded-md text-[13px] font-medium transition ${tab === t.k ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'}`}>
            {t.l}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {loading ? <Spinner /> : tab === 'payments' ? (
          payments.length === 0 ? (
            <div className="py-12"><EmptyState  title="No payments yet" description="Record your first payment to start tracking revenue." action={<Button onClick={() => setShowModal(true)}>Record payment</Button>} /></div>
          ) : (
            <>
            {/* Mobile: payment cards */}
            <div className="sm:hidden divide-y divide-[var(--line-soft)]">
              {payments.map((p: any) => (
                <div key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium text-[var(--ink)] truncate">{p.student?.full_name || '—'}</div>
                      <div className="text-[12px] text-[var(--ink-faint)]">{p.student?.phone}</div>
                    </div>
                    <div className="text-[15px] font-semibold text-[var(--ink)] flex-shrink-0">{formatGHS(p.amount)}</div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge tone={p.status === 'paid' ? 'success' : p.status === 'pending' ? 'warning' : 'danger'}>{p.status}</Badge>
                    <Badge tone={METHOD_TONE[p.method] || 'neutral'}>{p.method?.replace(/_/g, ' ') || '—'}</Badge>
                    {p.receipt_number && <span className="text-[11px] font-mono text-[var(--ink-faint)]">{p.receipt_number}</span>}
                    <span className="text-[11px] text-[var(--ink-faint)] ml-auto">{formatDateTime(p.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-[var(--line)]">
                  {['Receipt', 'Student', 'Amount', 'Method', 'Status', 'Date'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {payments.map((p: any) => (
                    <tr key={p.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)]">
                      <td className="px-4 py-3 text-[12px] font-mono text-[var(--ink-faint)]">{p.receipt_number || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[var(--ink)]">{p.student?.full_name || '—'}</div>
                        <div className="text-[12px] text-[var(--ink-faint)]">{p.student?.phone}</div>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-[var(--ink)]">{formatGHS(p.amount)}</td>
                      <td className="px-4 py-3"><Badge tone={METHOD_TONE[p.method] || 'neutral'}>{p.method?.replace(/_/g, ' ') || '—'}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={p.status === 'paid' ? 'success' : p.status === 'pending' ? 'warning' : 'danger'}>{p.status}</Badge></td>
                      <td className="px-4 py-3 text-[12px] text-[var(--ink-faint)]">{formatDateTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )
        ) : (
          invoices.length === 0 ? (
            <div className="py-12"><EmptyState  title="No invoices yet" description="Create an invoice to bill a student." action={<Button href="/finance/invoices/new">Create invoice</Button>} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-[var(--line)]">
                  {['Invoice', 'Student', 'Total', 'Paid', 'Balance', 'Due'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)]">
                      <td className="px-4 py-3 text-[12px] font-mono text-[var(--ink-faint)]">{inv.invoice_number || '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--ink)]">{inv.student?.full_name || '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-[var(--ink)]">{formatGHS(inv.total_amount)}</td>
                      <td className="px-4 py-3 text-sm text-[var(--ok)] font-medium">{formatGHS(inv.amount_paid)}</td>
                      <td className="px-4 py-3"><span className={`text-sm font-semibold ${Number(inv.outstanding) > 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}>{formatGHS(inv.outstanding || 0)}</span></td>
                      <td className="px-4 py-3 text-[12px] text-[var(--ink-faint)]">{inv.due_date || 'No due date'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>
    </div>
  )
}
