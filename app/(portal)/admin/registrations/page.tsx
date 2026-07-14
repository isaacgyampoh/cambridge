'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import Modal from '@/components/shared/Modal'
import { Search, FileText, Mail, Phone, X, Download } from 'lucide-react'
import { exportToExcel } from '@/lib/utils/export'

/**
 * Student Records — every registration application with the full set of
 * details captured from the registration link. The admin's master record.
 */
export default function AdminRegistrations() {
  const { data: apps, loading } = useData<any>({
    table: 'applications',
    select: '*, course:course_id(name, code), marketer:marketer_id(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 1000,
  })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<any>(null)

  const filtered = apps.filter((a: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (a.full_name || '').toLowerCase().includes(q)
      || (a.email || '').toLowerCase().includes(q)
      || (a.phone || '').includes(q)
      || (a.course?.name || '').toLowerCase().includes(q)
  })

  function exportAll() {
    exportToExcel(filtered.map((a: any) => ({
      'First name': a.first_name || '', 'Middle name': a.middle_name || '', 'Last name': a.last_name || '',
      'Full name': a.full_name, Email: a.email, Phone: a.phone, Gender: a.gender || '',
      'Date of birth': a.date_of_birth || '', 'Country of birth': a.country_of_birth || '',
      Nationality: a.nationality || '', 'Postal address': a.postal_address || '',
      'Residential address': a.residential_address || '', 'Last school': a.last_school || '',
      'Certification': a.certification_attained || '', 'Course of study': a.course_of_study || '',
      'Year completed': a.year_completed || '', Programme: a.course?.name || '',
      'Registered by': a.marketer?.full_name || '', 'Payment status': a.payment_status,
      Date: new Date(a.created_at).toLocaleDateString(),
    })), 'student-records')
  }

  const paid = apps.filter((a: any) => a.payment_status === 'paid').length

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Records"
        title="Student records"
        description="Every registration submitted through the system, with the full details each applicant provided."
        actions={<button onClick={exportAll} className="inline-flex items-center gap-1.5 h-10 px-4 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-lg text-sm font-medium hover:border-[var(--ink-faint)]"> Export</button>}
      />

      <div className="flex flex-wrap gap-2 mb-5">
        <Badge tone="accent">{apps.length} total</Badge>
        <Badge tone="success">{paid} paid registration</Badge>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-[var(--line)]">
          <div className="relative max-w-xs">
            
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, phone, course..." className={inputClass + ' pl-9'} />
          </div>
        </div>

        {loading ? <div className="p-8"><Spinner /></div> : filtered.length === 0 ? (
          <EmptyState  title="No registrations yet"
            description="When students register through a marketer link, their full records appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="rtc w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Name', 'Contact', 'Programme', 'Registered by', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a: any) => (
                  <tr key={a.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)] transition cursor-pointer" onClick={() => setSelected(a)}>
                    <td data-label="Name" className="px-4 py-3 font-medium text-[var(--ink)]">{a.full_name}</td>
                    <td data-label="Contact" className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-xs text-[var(--ink-soft)]">
                        {a.phone && <span className="flex items-center gap-1"> {String(a.phone).replace(/^233/, '0')}</span>}
                        {a.email && <span className="flex items-center gap-1"> {a.email}</span>}
                      </div>
                    </td>
                    <td data-label="Programme" className="px-4 py-3 text-sm text-[var(--ink-soft)]">{a.course?.name || '—'}</td>
                    <td data-label="Registered by" className="px-4 py-3 text-sm text-[var(--ink-soft)]">{a.marketer?.full_name || '—'}</td>
                    <td data-label="Status" className="px-4 py-3"><Badge tone={a.payment_status === 'paid' ? 'success' : 'warning'}>{a.payment_status}</Badge></td>
                    <td className="px-4 py-3 text-xs text-[var(--accent)] font-medium">View</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detail modal — full record */}
      <Modal open={!!selected} onClose={() => setSelected(null)} maxWidth="max-w-2xl">
        {selected && (
          <div className="p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{selected.full_name}</h2>
                <p className="text-sm text-[var(--ink-faint)]">{selected.course?.name || 'No programme'} · Registered {new Date(selected.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-[var(--ink-faint)] hover:text-[var(--ink)]"></button>
            </div>

            {[
              { title: 'Full name', rows: [['First name', selected.first_name], ['Middle name', selected.middle_name], ['Last name', selected.last_name]] },
              { title: 'Personal', rows: [['Date of birth', selected.date_of_birth], ['Gender', selected.gender], ['Country of birth', selected.country_of_birth], ['Nationality', selected.nationality]] },
              { title: 'Contact', rows: [['Email', selected.email], ['Phone', selected.phone && String(selected.phone).replace(/^233/, '0')], ['Postal address', selected.postal_address], ['Residential address', selected.residential_address]] },
              { title: 'Education', rows: [['Last school attended', selected.last_school], ['Certification attained', selected.certification_attained], ['Course of study', selected.course_of_study], ['Year completed', selected.year_completed]] },
              { title: 'Registration', rows: [['Programme', selected.course?.name], ['Registered by', selected.marketer?.full_name], ['Payment status', selected.payment_status], ['Payment method', selected.payment_method]] },
            ].map(section => (
              <div key={section.title} className="mb-5">
                <p className="text-[13px] font-medium text-[var(--accent)] mb-2">{section.title}</p>
                <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line-soft)]">
                  {section.rows.map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-[var(--ink-faint)]">{label}</span>
                      <span className="text-sm font-medium text-[var(--ink)] text-right">{val || <span className="text-[var(--ink-faint)] font-normal">—</span>}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
