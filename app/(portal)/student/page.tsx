'use client'
import { useState, useEffect } from 'react'
import { useData } from '@/hooks/useData'
import { formatGHS, formatDate } from '@/lib/utils'
import { BookOpen, DollarSign } from 'lucide-react'

export default function StudentDashboard() {
  const [myId, setMyId] = useState<string|null>(null)
  const [myName, setMyName] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      if (s.valid) { setMyId(s.userId); setMyName(s.fullName || '') }
    })
  }, [])

  const { data: enrollments, state: classesState } = useData({
    table: 'batch_students',
    select: '*, batch:batch_id(*, courses(name))',
    filters: myId ? [{ col: 'student_id', op: 'eq', val: myId }] : [],
    enabled: !!myId,
  })

  const { data: invoices, state: invoicesState } = useData({
    table: 'invoices',
    select: '*',
    filters: myId ? [{ col: 'student_id', op: 'eq', val: myId }] : [],
    orderBy: 'created_at',
    enabled: !!myId,
  })

  const totalOwed = invoices.reduce((a, i) => a + Number(i.outstanding || 0), 0)
  const owes = totalOwed > 0

  /*
   * THE ONE FIGURE THAT MUST NEVER BE GUESSED.
   *
   * invoices starts as an empty array and stays empty when the read fails, so
   * a student whose invoices could not be loaded was shown a bright green
   * banner reading "Nothing due". That is the most consequential sentence on
   * the page and it was being said on no evidence — somebody could arrive at
   * a class owing fees having been told by this portal that they did not.
   */
  const balanceUnknown = invoicesState === 'error' || invoicesState === 'loading'

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      {/*
        ── THE ONE THING, THEN THE FIGURES ──────────────────────────────────

        This was a thin green banner carrying the student's first name, above
        three identical white cards each with an icon, each the same size and
        weight. Nothing on the screen said which number mattered, so a student
        owing money and a student owing nothing saw the same page.

        Now the balance leads, and it is the only thing that changes colour:
        bright green when there is nothing to pay, amber when there is. The
        other two figures are quiet, because they are context rather than
        news.
      */}
      <section className="mb-4 rounded-[var(--radius-surface)] p-6 sm:p-7"
        style={{ background: balanceUnknown ? 'var(--line-soft)'
          : owes ? 'var(--attention)' : 'var(--accent-bright)' }}>
        {/*
          Dark ink on a bright fill, always. White on either of these is around
          1.4:1 and unreadable — the brightness is affordable precisely BECAUSE
          the text is dark.
        */}
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--ink)]/70">
          {balanceUnknown ? 'Your account' : owes ? 'To pay' : 'Your account'}
        </p>
        <p className="font-display mt-2 text-[34px] sm:text-[40px] font-semibold leading-none text-[var(--ink)]">
          {balanceUnknown
            ? (invoicesState === 'loading' ? 'Checking…' : 'Not available')
            : owes ? formatGHS(totalOwed) : 'Nothing due'}
        </p>
        <p className="mt-2.5 text-[14px] text-[var(--ink)]/75">
          {balanceUnknown && invoicesState === 'error'
            ? 'We could not check your balance just now — please try again shortly.'
            : `${myName.split(' ')[0] || 'Student'} · ${enrollments.length === 1 ? '1 class' : `${enrollments.length} classes`}`}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: 'Classes', value: enrollments.length, icon: BookOpen },
          { label: 'Invoices', value: invoices.length, icon: DollarSign },
        ].map(s => (
          <div key={s.label}
            className="rounded-[var(--radius-surface)] border border-[var(--line)] bg-[var(--paper)] p-5">
            <div className="flex items-center gap-2 text-[var(--ink-faint)]">
              <s.icon size={15} aria-hidden="true" />
              <span className="text-[12px] font-medium">{s.label}</span>
            </div>
            <div className="font-display mt-2.5 text-[28px] font-semibold leading-none text-[var(--ink)]">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Classes */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 mb-4 shadow-[var(--shadow-raised)]">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">My Classes</h3>
        {/*
          * "Not enrolled in any classes yet" is alarming and wrong when the
          * truth is that the list could not be loaded — and it is exactly what
          * a student saw, because only `data` was read and a failure left it
          * as an empty array.
          */}
        {classesState === 'error' ? (
          <p className="text-sm text-[var(--attention)] text-center py-6">
            We could not load your classes just now. Please pull down to refresh.
          </p>
        ) : classesState === 'loading' ? (
          <p className="text-sm text-[var(--ink-faint)] text-center py-6">Loading your classes…</p>
        ) : enrollments.length === 0 ? (
          <p className="text-sm text-[var(--ink-faint)] text-center py-6">Not enrolled in any classes yet</p>
        ) : enrollments.map((e: any) => {
          const batch = e.batch
          return (
            <div key={e.id} className="flex items-center gap-3 py-3 border-b border-[var(--line-soft)] last:border-0">
              {/* This was an empty 36px square — a placeholder whose icon had
                  gone, leaving a coloured box that meant nothing next to every
                  class. */}
              <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
                <BookOpen size={16} className="text-[var(--accent)]" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--ink)]">{batch?.courses?.name}</div>
                <div className="text-xs text-[var(--ink-faint)]">{batch?.name} · {batch?.schedule || 'Schedule TBD'}</div>
                {batch?.start_date && <div className="text-xs text-[var(--ink-faint)]">{formatDate(batch.start_date)}</div>}
              </div>
              <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${batch?.status==='ongoing'?'bg-[var(--ok-soft)] text-[var(--ok)]':'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
                {batch?.status || 'upcoming'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Invoices */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 shadow-[var(--shadow-raised)]">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">My Invoices</h3>
        {invoicesState === 'error' ? (
          <p className="text-sm text-[var(--attention)] text-center py-6">
            We could not load your invoices just now.
          </p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-[var(--ink-faint)] text-center py-6">No invoices yet</p>
        ) : invoices.map(inv => (
          <div key={inv.id} className="flex items-center justify-between py-3 border-b border-[var(--line-soft)] last:border-0">
            <div>
              <div className="text-xs font-mono text-[var(--ink-faint)]">{inv.invoice_number || '—'}</div>
              <div className="text-sm font-semibold text-[var(--ink)]">{formatGHS(inv.total_amount)}</div>
              {inv.due_date && <div className="text-xs text-[var(--ink-faint)]">Due: {formatDate(inv.due_date)}</div>}
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${Number(inv.outstanding)===0?'bg-[var(--ok-soft)] text-[var(--ok)]':'bg-[var(--danger-soft)] text-[var(--danger)]'}`}>
              {Number(inv.outstanding)===0 ? 'Paid ': `Owes ${formatGHS(inv.outstanding)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
