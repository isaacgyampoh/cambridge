'use client'
import { useState, useEffect } from 'react'
import { readableStatus } from '@/lib/ui/status'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, EmptyState, inputClass, StatCard } from '@/components/ui'
import { DataTable, type Column } from '@/components/ui/DataTable'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'
import type { StudentFee } from '@/types'

/*
 * The local shape here declared student_name and status as non-null, which
 * student_fees does not guarantee. Using the shared row means this screen and
 * the API that writes it cannot disagree about which columns can be empty.
 */
type Fee = StudentFee

export default function StudentFeesPage() {
  const { data: fees, loading, refetch } = useData<StudentFee>({ table: 'student_fees', select: '*', orderBy: 'created_at', orderAsc: false, limit: 1000 })
  const [pending, setPending] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'students' | 'pending'>('students')
  const [acting, setActing] = useState<string | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [recordFor, setRecordFor] = useState<any>(null)
  /*
   * Correcting what a student is charged.
   *
   * total_fee is a snapshot taken when they registered and nothing could
   * change it afterwards, so anybody registered under an old price list
   * showed that price for ever — here, in their portal, and in any reminder
   * quoting their balance.
   */
  const [repriceFor, setRepriceFor] = useState<any>(null)
  const [repriceAmt, setRepriceAmt] = useState('')
  const [repriceWhy, setRepriceWhy] = useState('')
  /*
   * Putting a whole programme onto its current fee.
   *
   * Correcting a course does not move the snapshots of students already
   * registered, so after a price list is fixed every one of them still holds
   * the old figure. One at a time is fine for a few and never happens for a
   * cohort.
   */
  const { data: courses } = useData<{ id: string; name: string; is_active?: boolean }>({
    table: 'courses', select: 'id, name, is_active', limit: 200,
  })
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkCourse, setBulkCourse] = useState('')
  const [bulkWhy, setBulkWhy] = useState('')
  const [bulkPlan, setBulkPlan] = useState<any>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [recordAmt, setRecordAmt] = useState('')

  const [pendingError, setPendingError] = useState<string | null>(null)

  /**
   * Payments waiting to be verified.
   *
   * A failure used to resolve to `{ payments: [] }`, so an unreachable server
   * looked exactly like nobody having paid — the queue emptied itself on
   * screen and an accountant had no reason to look again. These are payments
   * students have actually made.
   */
  async function loadPending() {
    try {
      const res = await fetch('/api/fees/verify')
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || 'Could not load payments awaiting verification.')
      setPending((d.payments || []).filter((p: any) => p.status === 'pending'))
      setPendingError(null)
    } catch (e) {
      setPending([])
      setPendingError(e instanceof Error && e.message
        ? e.message
        : 'We could not load payments awaiting verification. Please try again.')
    }
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

  async function reprice(useCourseFee: boolean) {
    if (!repriceFor) return
    if (acting === repriceFor.id) return          // a second click changes nothing
    setActing(repriceFor.id)
    try {
      const res = await fetch('/api/fees/reprice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentFeeId: repriceFor.id,
          totalFee: useCourseFee ? undefined : repriceAmt,
          useCourseFee,
          reason: repriceWhy,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { toast.error(d.error || 'That fee could not be changed.'); return }

      toast.success(`Fee corrected from GHS ${Number(d.previousTotal).toFixed(2)} to GHS ${Number(d.totalFee).toFixed(2)}.`)
      // A fee below what was already paid leaves the student in credit. That
      // is a real state and an unusual one, so it is said rather than shown
      // as a quiet minus sign.
      if (d.inCredit) toast.error(`${repriceFor.student_name} is now in credit by GHS ${Math.abs(Number(d.balance)).toFixed(2)}.`)
      setRepriceFor(null); setRepriceAmt(''); setRepriceWhy('')
      refetch()
    } catch {
      toast.error('The server could not be reached. Nothing was changed.')
    } finally {
      setActing(null)
    }
  }

  async function bulkPreview() {
    if (!bulkCourse) { toast.error('Choose a programme.'); return }
    setBulkBusy(true); setBulkPlan(null)
    try {
      const d = await fetch('/api/fees/reprice-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: bulkCourse }),
      }).then(r => r.json())
      if (d.error) { toast.error(d.error); return }
      setBulkPlan(d)
      if (!d.changes?.length) toast.success('Everybody on that programme is already on the current fee.')
    } catch { toast.error('Could not work out what would change.') }
    finally { setBulkBusy(false) }
  }

  async function bulkApply() {
    if (!bulkPlan?.changes?.length) return
    if (bulkBusy) return
    /*
     * Confirmed against the EXACT list that was shown. If the roster has
     * moved since, the server refuses rather than re-pricing people this
     * screen never listed.
     */
    setBulkBusy(true)
    try {
      const res = await fetch('/api/fees/reprice-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: bulkCourse, reason: bulkWhy,
          confirmIds: bulkPlan.changes.map((c: any) => c.id),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) {
        toast.error(d.error || 'Could not apply.')
        if (d.stale) setBulkPlan(d)
        return
      }
      toast.success(`${d.applied} of ${d.planned} students re-priced.`)
      if (d.creditCount) toast.error(`${d.creditCount} are now in credit — they have paid more than the new fee.`)
      if (d.failures?.length) toast.error(`${d.failures.length} could not be changed.`)
      setBulkOpen(false); setBulkPlan(null); setBulkWhy('')
      refetch()
    } catch { toast.error('The server could not be reached.') }
    finally { setBulkBusy(false) }
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

  /*
   * Money on a phone was the worst case for the old horizontal scroll: seven
   * columns meant dragging sideways to see whether a balance was outstanding.
   * Described once here, rendered as a table on a desktop and a card per
   * student below sm.
   */
  const ghs = (n: number) => `GHS ${Number(n || 0).toFixed(2)}`

  const feeColumns: Column<Fee>[] = [
    {
      key: 'student', header: 'Student', primary: true,
      render: f => f.student_name,
    },
    {
      key: 'mode', header: 'Class', secondary: true,
      render: f => f.delivery === 'online' ? 'Online' : 'In person',
    },
    { key: 'course', header: 'Course', render: f => f.course_name || '—' },
    { key: 'total', header: 'Total', numeric: true, render: f => ghs(f.total_fee) },
    {
      key: 'paid', header: 'Paid', numeric: true,
      render: f => <span className="text-[var(--ok)]">{ghs(f.amount_paid)}</span>,
    },
    {
      key: 'balance', header: 'Balance', numeric: true,
      render: f => (
        <span className={Number(f.balance) > 0 ? 'font-medium text-[var(--warn)]' : 'text-[var(--ink-faint)]'}>
          {ghs(f.balance)}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: f => (
        <Badge tone={f.status === 'paid' ? 'success' : f.status === 'partial' ? 'warning' : 'neutral'}>
          {readableStatus(f.status)}
        </Badge>
      ),
    },
    {
      key: 'action', header: 'Record',
      render: f => (
        <div className="flex gap-1.5 justify-end">
          {f.status !== 'paid' && (
            <Button size="sm" variant="secondary"
              onClick={() => { setRecordFor(f); setRecordAmt(String(f.balance)) }}>
              Record payment
            </Button>
          )}
          {/* Available whatever the status: a fee charged wrongly is worth
              correcting after it has been settled, not only before. */}
          <Button size="sm" variant="secondary"
            onClick={() => { setRepriceFor(f); setRepriceAmt(String(f.total_fee ?? '')); setRepriceWhy('') }}>
            Correct fee
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader eyebrow="Finance" title="Student fees"
        description="Every registered student and what they owe. Verify bank and cash payments here."
        actions={<Button variant="secondary" onClick={() => { setBulkOpen(true); setBulkPlan(null) }}>Re-price a programme</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Students" value={String((fees || []).length)} />
        <StatCard label="Collected" value={`GHS ${totalCollected.toFixed(0)}`} />
        <StatCard label="Outstanding" value={`GHS ${totalOwing.toFixed(0)}`} />
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('students')} className={`text-sm font-medium px-4 h-11 sm:h-9 rounded-lg ${tab === 'students' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--paper)] border border-[var(--line)] text-[var(--ink-soft)]'}`}>All students</button>
        <button onClick={() => setTab('pending')} className={`text-sm font-medium px-4 h-11 sm:h-9 rounded-lg ${tab === 'pending' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--paper)] border border-[var(--line)] text-[var(--ink-soft)]'}`}>
          To verify {pending.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--warn)] text-white text-[11px]">{pending.length}</span>}
        </button>
      </div>

      {tab === 'students' ? (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-[var(--line)]">
            <div className="relative max-w-xs">
              
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…" className={inputClass + ' pl-9'} />
            </div>
          </div>
          <DataTable<Fee>
            caption="Registered students and their fees"
            state={loading ? 'loading' : 'ready'}
            rows={filtered}
            rowKey={f => f.id}
            // A balance still owed. The amber column already said so; the row
            // says it before anybody reads a column.
            needsAttention={f => Number(f.balance) > 0}
            columns={feeColumns}
            emptyTitle="No registered students yet"
            emptyMessage="Students appear here automatically once they register."
          />
        </Card>
      ) : (
        pendingError ? (
          /* Not "nothing to verify" — these are payments students have made. */
          <Card>
            <p className="text-sm text-[var(--danger)]">{pendingError}</p>
            <Button className="mt-4" onClick={() => loadPending()}>Try again</Button>
          </Card>
        ) : pending.length === 0 ? (
          <EmptyState  title="Nothing to verify" description="Bank and cash payments awaiting your confirmation will appear here." />
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
                  {p.screenshot_url && <a href={p.screenshot_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] font-medium ml-auto"> Screenshot</a>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--ink-faint)]">Confirm GHS</span>
                    <input value={amounts[p.id] ?? String(p.amount)} onChange={e => setAmounts(a => ({ ...a, [p.id]: e.target.value }))} type="number" className={inputClass + ' w-24 h-9'} />
                  </div>
                  <Button size="sm" disabled={acting === p.id} onClick={() => decide(p, 'verify')} >Verify</Button>
                  <Button size="sm" variant="secondary" disabled={acting === p.id} onClick={() => decide(p, 'reject')} >Reject</Button>
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

      <Modal open={bulkOpen} onClose={() => { if (!bulkBusy) { setBulkOpen(false); setBulkPlan(null) } }} maxWidth="max-w-lg">
        <div className="p-6">
          <h2 className="font-display text-lg font-semibold text-[var(--ink)] mb-1">Re-price a programme</h2>
          <p className="text-sm text-[var(--ink-soft)] mb-4">
            Puts every student on one programme onto its current fee. Nothing changes until you
            have seen exactly who is affected.
          </p>

          <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase mb-1.5">Programme</label>
          <select className={inputClass + ' mb-3'} value={bulkCourse}
            onChange={e => { setBulkCourse(e.target.value); setBulkPlan(null) }} aria-label="Programme">
            <option value="">Choose a programme</option>
            {(courses || []).filter(c => c.is_active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {!bulkPlan ? (
            <div className="flex gap-2">
              <Button onClick={bulkPreview} disabled={bulkBusy || !bulkCourse}>
                {bulkBusy ? 'Checking…' : 'Show me what would change'}
              </Button>
              <Button variant="secondary" onClick={() => setBulkOpen(false)}>Cancel</Button>
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-[var(--canvas)] border border-[var(--line)] p-3 mb-3 text-[13px]">
                <div className="text-[var(--ink)] font-medium mb-1">
                  {bulkPlan.changes?.length || 0} student{bulkPlan.changes?.length === 1 ? '' : 's'} would change
                </div>
                <div className="text-[12px] text-[var(--ink-soft)] leading-relaxed">
                  Current fee: GHS {Number(bulkPlan.inPerson || 0).toLocaleString()} in person ·
                  {' '}GHS {Number(bulkPlan.online || 0).toLocaleString()} online.<br />
                  Outstanding across them: GHS {Number(bulkPlan.owedBefore || 0).toLocaleString()}
                  {' → '}GHS {Number(bulkPlan.owedAfter || 0).toLocaleString()}.
                  {bulkPlan.creditCount > 0 && (
                    <><br /><span className="text-[var(--danger)]">
                      {bulkPlan.creditCount} would end up in credit — they have paid more than the new fee.
                    </span></>
                  )}
                  {bulkPlan.skipped?.length > 0 && (
                    <><br />{bulkPlan.skipped.length} left out (already correct, or no class mode recorded).</>
                  )}
                </div>
              </div>

              {bulkPlan.changes?.length > 0 && (
                <div className="max-h-48 overflow-y-auto mb-3 space-y-1">
                  {bulkPlan.changes.map((c: any) => (
                    <div key={c.id} className="flex justify-between gap-3 text-[12px] py-1 border-b border-[var(--line-soft)] last:border-0">
                      <span className="text-[var(--ink)] truncate">{c.student}</span>
                      <span className="text-[var(--ink-soft)] flex-shrink-0">
                        GHS {Number(c.from).toLocaleString()} → GHS {Number(c.to).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {bulkPlan.changes?.length > 0 && (
                <>
                  <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase mb-1.5">Why</label>
                  <input value={bulkWhy} onChange={e => setBulkWhy(e.target.value)}
                    placeholder="e.g. fee list corrected" className={inputClass + ' mb-4'} aria-label="Reason" />
                </>
              )}

              <div className="flex flex-wrap gap-2">
                {bulkPlan.changes?.length > 0 && (
                  <Button onClick={bulkApply} disabled={bulkBusy}>
                    {bulkBusy ? 'Applying…' : `Re-price ${bulkPlan.changes.length}`}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setBulkPlan(null)} disabled={bulkBusy}>Back</Button>
                <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>Cancel</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={!!repriceFor} onClose={() => setRepriceFor(null)} maxWidth="max-w-sm">
        {repriceFor && (
          <div className="p-6">
            <h2 className="font-display text-lg font-semibold text-[var(--ink)] mb-1">Correct the fee</h2>
            <p className="text-sm text-[var(--ink-soft)] mb-4">
              {repriceFor.student_name} · {repriceFor.course_name || 'no programme'} ·
              {' '}currently GHS {Number(repriceFor.total_fee || 0).toFixed(2)}
            </p>

            <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase mb-1.5">Corrected fee</label>
            <input value={repriceAmt} onChange={e => setRepriceAmt(e.target.value)} type="number"
              className={inputClass + ' mb-3'} aria-label="Corrected fee" />

            <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase mb-1.5">Why</label>
            <input value={repriceWhy} onChange={e => setRepriceWhy(e.target.value)}
              placeholder="e.g. charged the old price list"
              className={inputClass + ' mb-4'} aria-label="Reason for the correction" />

            <p className="text-[12px] text-[var(--ink-soft)] leading-relaxed mb-4">
              GHS {Number(repriceFor.amount_paid || 0).toFixed(2)} already paid is not changed —
              only what is owed. The reason is kept on the record.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => reprice(false)} disabled={acting === repriceFor.id}>
                {acting === repriceFor.id ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" onClick={() => reprice(true)} disabled={acting === repriceFor.id}>
                Use current course fee
              </Button>
              <Button variant="secondary" onClick={() => setRepriceFor(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
