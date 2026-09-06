'use client'

import { useState, useMemo } from 'react'
import { useData } from '@/hooks/useData'
import {
  PageHeader, Card, Button, Search, Tabs, StatusBadge, Avatar,
  MobileList, ListRow, Dialog, SectionHeader, ProgressSteps,
} from '@/components/ui'
import { telHref, whatsappHref, mailtoHref } from '@/lib/ui/contact'
import { Phone, MessageSquare, Mail } from 'lucide-react'
import { exportToExcel } from '@/lib/utils/export'
import { displayPhone } from '@/lib/ui/contact'
import { describeStatus } from '@/lib/ui/status'
import { parseClassMode } from '@/lib/classMode'

/**
 * Student records — every registration submitted through the system.
 *
 * ── CLASS MODE WAS NOT ON THIS SCREEN AT ALL ───────────────────────────────
 *
 * The table had five columns — name, contact, programme, registered by,
 * payment status — and the detail panel had five sections. `delivery`, the
 * field that decides whether somebody is taught over Zoom or at the campus and
 * which admission letter they are sent, appeared in neither.
 *
 * This is the master record of who registered for what. Somebody checking why
 * a student received the wrong letter would open this screen, and the answer
 * was not on it. It is now the second thing on every row, as a badge, using
 * the one label the whole product uses for that mode — and it can be filtered
 * on, so "show me everyone doing this online" is one tap.
 *
 * A record with no mode recorded shows as "Mode not set" rather than
 * defaulting to either, because defaulting is precisely how the wrong letter
 * gets chosen.
 */

type Application = {
  id: string
  full_name: string
  phone?: string | null
  email?: string | null
  delivery?: string | null
  payment_status: string
  created_at: string
  first_name?: string | null
  middle_name?: string | null
  last_name?: string | null
  gender?: string | null
  date_of_birth?: string | null
  country_of_birth?: string | null
  nationality?: string | null
  postal_address?: string | null
  residential_address?: string | null
  last_school?: string | null
  certification_attained?: string | null
  course_of_study?: string | null
  year_completed?: string | null
  payment_method?: string | null
  course?: { name?: string; code?: string } | null
  marketer?: { full_name?: string } | null
}

export default function AdminRegistrations() {
  const { data: apps, state, refetch } = useData<Application>({
    table: 'applications',
    select: '*, course:course_id(name, code), marketer:marketer_id(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 1000,
  })

  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('all')
  const [selected, setSelected] = useState<Application | null>(null)

  const counts = useMemo(() => {
    const out = { all: apps.length, paid: 0, pending: 0, online: 0, in_person: 0, unset: 0 }
    for (const a of apps) {
      if (a.payment_status === 'paid') out.paid++
      else out.pending++
      const mode = parseClassMode(a.delivery)
      if (mode === 'online') out.online++
      else if (mode === 'in_person') out.in_person++
      else out.unset++
    }
    return out
  }, [apps])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return apps.filter(a => {
      const mode = parseClassMode(a.delivery)
      if (tab === 'paid' && a.payment_status !== 'paid') return false
      if (tab === 'pending' && a.payment_status === 'paid') return false
      if (tab === 'online' && mode !== 'online') return false
      if (tab === 'in_person' && mode !== 'in_person') return false
      if (tab === 'unset' && mode !== null) return false
      if (!needle) return true
      return (
        (a.full_name || '').toLowerCase().includes(needle) ||
        (a.email || '').toLowerCase().includes(needle) ||
        (a.phone || '').includes(needle) ||
        displayPhone(a.phone).includes(needle) ||
        (a.course?.name || '').toLowerCase().includes(needle)
      )
    })
  }, [apps, tab, query])

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'pending', label: 'Awaiting payment', count: counts.pending },
    { key: 'paid', label: 'Paid', count: counts.paid },
    { key: 'online', label: describeStatus('classMode', 'online').label, count: counts.online },
    { key: 'in_person', label: describeStatus('classMode', 'in_person').label, count: counts.in_person },
    // Only offered when there is something wrong to look at. These are the
    // records that produce a wrong admission letter.
    ...(counts.unset ? [{ key: 'unset', label: 'Mode not set', count: counts.unset }] : []),
  ]

  async function exportAll() {
    await exportToExcel(shown.map(a => ({
      'First name': a.first_name || '', 'Middle name': a.middle_name || '', 'Last name': a.last_name || '',
      'Full name': a.full_name, Email: a.email, Phone: a.phone, Gender: a.gender || '',
      'Date of birth': a.date_of_birth || '', 'Country of birth': a.country_of_birth || '',
      Nationality: a.nationality || '', 'Postal address': a.postal_address || '',
      'Residential address': a.residential_address || '', 'Last school': a.last_school || '',
      Certification: a.certification_attained || '', 'Course of study': a.course_of_study || '',
      'Year completed': a.year_completed || '', Programme: a.course?.name || '',
      // The same label the screen shows, so an export and the portal cannot
      // disagree about what mode somebody is on.
      'Class mode': describeStatus('classMode', a.delivery).label,
      'Registered by': a.marketer?.full_name || '', 'Payment status': a.payment_status,
      Date: new Date(a.created_at).toLocaleDateString(),
    })), 'student-records')
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Records"
        title="Student records"
        description="Every registration submitted through the system, with the details each applicant gave."
        actions={
          <Button variant="secondary" size="sm" onClick={exportAll} disabled={!shown.length}>
            Export {shown.length === apps.length ? 'all' : 'these'}
          </Button>
        }
      />

      {/* Records with no class mode produce the wrong admission letter, so
          they are called out rather than left to be noticed. */}
      {counts.unset > 0 && tab !== 'unset' && (
        <Card className="p-4 mb-4 border-[var(--warn)]/30 bg-[var(--warn-soft)]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14px] text-[var(--ink)] leading-snug">
              <strong className="font-semibold">{counts.unset}</strong>{' '}
              {counts.unset === 1 ? 'registration has' : 'registrations have'} no class mode
              recorded. They cannot be sent the right admission letter until one is set.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setTab('unset')}>Show</Button>
          </div>
        </Card>
      )}

      <div className="space-y-3 mb-4">
        <Search value={query} onChange={setQuery}
          placeholder="Search name, email, phone or programme" label="Search registrations" />
        <Tabs tabs={tabs} active={tab} onChange={setTab} label="Filter registrations" />
      </div>

      <MobileList
        rows={shown}
        rowKey={a => a.id}
        state={state}
        onRetry={refetch}
        errorTitle="Could not load student records"
        errorMessage="This is not an empty list — the request failed. Try again."
        emptyTitle={query || tab !== 'all' ? 'Nothing matches' : 'No registrations yet'}
        emptyMessage={
          query || tab !== 'all'
            ? 'Try a different search, or clear the filter.'
            : 'When students register through a marketer link, their records appear here.'
        }
        emptyAction={
          (query || tab !== 'all')
            ? <Button variant="secondary" onClick={() => { setQuery(''); setTab('all') }}>Show all</Button>
            : undefined
        }
        renderRow={a => (
          <ListRow
            onClick={() => setSelected(a)}
            leading={<Avatar name={a.full_name} />}
            title={a.full_name}
            subtitle={a.course?.name || 'No programme recorded'}
            status={<StatusBadge domain="payment" value={a.payment_status} />}
            meta={
              <>
                {/* Class mode, on the row, in the product's one label for it. */}
                <StatusBadge domain="classMode" value={a.delivery} size="sm" showDot />
                <span>{displayPhone(a.phone)}</span>
                <span className="tabular-nums">
                  {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </>
            }
          />
        )}
      />

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected?.full_name || ''}
        description={selected
          ? `${selected.course?.name || 'No programme'} · registered ${new Date(selected.created_at)
              .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
          : undefined}
      >
        {selected && (
          <>
            {/* The two facts somebody opens this record to check, first. */}
            <div className="flex flex-wrap gap-2 mb-5">
              <StatusBadge domain="classMode" value={selected.delivery} showDot />
              <StatusBadge domain="payment" value={selected.payment_status} />
            </div>

            {/*
              How far this registration has got.

              Only the three stages THIS record decides are shown. Admission
              rows are keyed on the lead, not on the application, so this
              screen genuinely cannot see whether a letter has been issued —
              and a fourth step that stayed permanently unfinished for an
              already-admitted student would be worse than not showing one.
              The admissions queue is where that part lives.
            */}
            <ProgressSteps
              className="mb-6"
              current={selected.payment_status === 'paid' ? 2 : 1}
              steps={[
                {
                  label: 'Application',
                  detail: new Date(selected.created_at)
                    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                },
                {
                  label: 'Payment',
                  detail: selected.payment_status === 'paid'
                    ? (selected.payment_method || 'Received')
                    : 'Not yet received',
                },
                {
                  label: 'Admission',
                  detail: selected.payment_status === 'paid'
                    ? 'Being processed'
                    : 'Starts once paid',
                },
              ]}
            />

            {/*
              Reaching the student, from the record itself.

              Every one of these comes from lib/ui/contact, so a number typed
              with spaces still produces a link that opens, and a missing one
              produces no button at all rather than a dead control.
            */}
            {(telHref(selected.phone) || whatsappHref(selected.phone) || mailtoHref(selected.email)) && (
              <div className="flex flex-wrap gap-2 mb-6">
                {telHref(selected.phone) && (
                  <a href={telHref(selected.phone) as string}
                    className="inline-flex items-center gap-2 h-11 px-4 rounded-xl
                      bg-[var(--navy)] text-white text-[14px] font-semibold
                      hover:brightness-110 transition">
                    <Phone size={16} aria-hidden="true" /> Call
                  </a>
                )}
                {whatsappHref(selected.phone) && (
                  <a href={whatsappHref(selected.phone) as string}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-11 px-4 rounded-xl
                      border border-[var(--line)] text-[var(--ink)] text-[14px] font-semibold
                      hover:bg-[var(--canvas)] transition">
                    <MessageSquare size={16} aria-hidden="true" /> WhatsApp
                  </a>
                )}
                {mailtoHref(selected.email) && (
                  <a href={mailtoHref(selected.email) as string}
                    className="inline-flex items-center gap-2 h-11 px-4 rounded-xl
                      border border-[var(--line)] text-[var(--ink)] text-[14px] font-semibold
                      hover:bg-[var(--canvas)] transition">
                    <Mail size={16} aria-hidden="true" /> Email
                  </a>
                )}
              </div>
            )}

            {[
              { title: 'Registration', rows: [
                ['Programme', selected.course?.name],
                ['Class mode', describeStatus('classMode', selected.delivery).label],
                ['Registered by', selected.marketer?.full_name],
                ['Payment method', selected.payment_method],
              ] },
              { title: 'Full name', rows: [
                ['First name', selected.first_name],
                ['Middle name', selected.middle_name],
                ['Last name', selected.last_name],
              ] },
              { title: 'Personal', rows: [
                ['Date of birth', selected.date_of_birth],
                ['Gender', selected.gender],
                ['Country of birth', selected.country_of_birth],
                ['Nationality', selected.nationality],
              ] },
              { title: 'Contact', rows: [
                ['Email', selected.email],
                ['Phone', selected.phone ? displayPhone(selected.phone) : null],
                ['Postal address', selected.postal_address],
                ['Residential address', selected.residential_address],
              ] },
              { title: 'Education', rows: [
                ['Last school attended', selected.last_school],
                ['Certification attained', selected.certification_attained],
                ['Course of study', selected.course_of_study],
                ['Year completed', selected.year_completed],
              ] },
            ].map(section => (
              <section key={section.title} className="mb-5">
                <SectionHeader title={section.title} />
                <dl className="rounded-2xl border border-[var(--line)] divide-y divide-[var(--line-soft)]">
                  {section.rows.map(([label, value]) => (
                    <div key={String(label)}
                      className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                      <dt className="text-[13px] text-[var(--ink-faint)] flex-shrink-0">{label}</dt>
                      <dd className="text-[13px] font-medium text-[var(--ink)] text-right break-words min-w-0">
                        {value || <span className="text-[var(--ink-faint)] font-normal">Not given</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </>
        )}
      </Dialog>
    </div>
  )
}
