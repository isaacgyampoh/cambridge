'use client'
import { useState, useEffect, use } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/utils'
import { GraduationCap, Search, Phone, Mail } from 'lucide-react'
import Link from 'next/link'

/**
 * Per-course lead view. Shows every lead whose course_interest matches
 * this course (by code or name, flexibly). Reached from the auto-generated
 * nav entry created for each active course.
 */
export default function CourseLeadsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const decoded = decodeURIComponent(code)

  const { data: courses } = useData<any>({ table: 'courses', select: 'id, name, code', limit: 200 })
  const { data: leads, loading } = useData<any>({
    table: 'leads',
    select: '*, assignee:assigned_to(full_name)',
    orderBy: 'created_at', orderAsc: false, limit: 1000,
  })
  const [search, setSearch] = useState('')

  const course = courses.find((c: any) => (c.code || '').toLowerCase() === decoded.toLowerCase())
    || courses.find((c: any) => (c.name || '').toLowerCase() === decoded.toLowerCase())

  const courseName = course?.name || decoded
  const courseCode = course?.code || decoded

  // Flexible match: lead.course_interest contains the course name or code
  function matchesCourse(lead: any): boolean {
    const ci = (lead.course_interest || '').toLowerCase().trim()
    if (!ci) return false
    const n = (courseName || '').toLowerCase()
    const c = (courseCode || '').toLowerCase()
    return ci.includes(n) || (n && n.includes(ci)) || ci === c || ci.includes(c)
  }

  const courseLeads = leads.filter(matchesCourse).filter((l: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (l.full_name || '').toLowerCase().includes(q) || (l.phone || '').includes(q)
  })

  const byStatus: Record<string, number> = {}
  courseLeads.forEach((l: any) => { byStatus[l.status] = (byStatus[l.status] || 0) + 1 })

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Course leads"
        title={courseName}
        description={`All leads interested in ${courseName}${courseCode && courseCode !== courseName ? ` (${courseCode})` : ''}.`}
      />

      {/* Quick stats */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Badge tone="accent">{courseLeads.length} total</Badge>
        {byStatus['registered'] > 0 && <Badge tone="success">{byStatus['registered']} registered</Badge>}
        {byStatus['follow_up'] > 0 && <Badge tone="warning">{byStatus['follow_up']} following up</Badge>}
        {byStatus['new'] > 0 && <Badge tone="neutral">{byStatus['new']} new</Badge>}
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-[var(--line)]">
          <div className="relative max-w-xs">
            
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or phone..."
              className={inputClass + ' pl-9'} />
          </div>
        </div>

        {loading ? <div className="p-8"><Spinner /></div> : courseLeads.length === 0 ? (
          <EmptyState  title="No leads for this course yet"
            description={`When leads come in interested in ${courseName}, they'll appear here.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['Name', 'Contact', 'Status', 'Assigned to', 'Date'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {courseLeads.map((l: any) => (
                  <tr key={l.id} className="border-b border-[var(--line-soft)] last:border-0 hover:bg-[var(--line-soft)] transition">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads`} className="font-medium text-[var(--ink)] hover:text-[var(--accent)]">{l.full_name}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-xs text-[var(--ink-soft)]">
                        {l.phone && <span className="flex items-center gap-1"> {String(l.phone).replace(/^233/, '0')}</span>}
                        {l.email && <span className="flex items-center gap-1"> {l.email}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-[12px] font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[l.status] || 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                        {STATUS_LABELS[l.status] || l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-soft)]">{l.assignee?.full_name || <span className="text-[var(--ink-faint)]">Unassigned</span>}</td>
                    <td className="px-4 py-3 text-[12px] text-[var(--ink-faint)]">
                      {new Date(l.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                    </td>
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
