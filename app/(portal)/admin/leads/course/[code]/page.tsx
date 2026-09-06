'use client'
import { useState, use } from 'react'
import { displayPhone } from '@/lib/ui/contact'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Badge, inputClass } from '@/components/ui'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/utils'
import Link from 'next/link'

/**
 * Per-course lead view. Shows every lead whose course_interest matches
 * this course (by code or name, flexibly). Reached from the auto-generated
 * nav entry created for each active course.
 */
type CourseLead = {
  id: string
  full_name: string
  phone?: string | null
  email?: string | null
  status: string
  assignee?: { full_name?: string } | null
  created_at: string
}

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

  const courseLeadColumns: Column<CourseLead>[] = [
    {
      key: 'name', header: 'Name', primary: true,
      render: l => (
        <Link href="/admin/leads"
          className="font-medium text-[var(--ink)] hover:text-[var(--accent)]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
          {l.full_name}
        </Link>
      ),
    },
    {
      key: 'contact', header: 'Contact', secondary: true,
      render: l => (
        <>
          {l.phone && <div>{displayPhone(l.phone)}</div>}
          {l.email && <div className="text-[var(--ink-faint)] text-[12px]">{l.email}</div>}
        </>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: l => (
        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full
          ${STATUS_COLORS[l.status] || 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
          {STATUS_LABELS[l.status] || l.status?.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'owner', header: 'Assigned to',
      render: l => l.assignee?.full_name
        || <span className="text-[var(--ink-faint)]">Unassigned</span>,
    },
    {
      key: 'date', header: 'Added',
      render: l => (
        <span className="text-[var(--ink-faint)] text-[12px]">
          {new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
      ),
    },
  ]

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
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

        <DataTable<CourseLead>
          caption={`Leads interested in ${courseName}`}
          state={loading ? 'loading' : 'ready'}
          rows={courseLeads}
          rowKey={l => l.id}
          columns={courseLeadColumns}
          emptyTitle="No leads for this course yet"
          emptyMessage={`When leads come in interested in ${courseName}, they will appear here.`}
        />
      </Card>
    </div>
  )
}
