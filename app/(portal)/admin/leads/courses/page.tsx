'use client'
import { useState, useEffect } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Spinner, EmptyState, Badge } from '@/components/ui'
import { GraduationCap, ArrowRight, Plus } from 'lucide-react'
import Link from 'next/link'

/**
 * Course Leads hub — one card per course. Click a course to see all its
 * leads. Always available regardless of nav state. Counts are computed
 * from the leads in scope (own leads for marketers, all for admin/PM).
 */
export default function CourseLeadsHub() {
  const [role, setRole] = useState<string>('')
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => { if (s?.valid) setRole(s.role) })
  }, [])
  const isAdmin = role === 'super_admin'

  const { data: courses, loading } = useData<any>({ table: 'courses', select: 'id, name, code, is_active', orderBy: 'name', orderAsc: true, limit: 200 })
  const { data: leads } = useData<any>({ table: 'leads', select: 'id, course_interest, status', limit: 2000 })

  function matchesCourse(ci: string, course: any): boolean {
    ci = (ci || '').toLowerCase().trim()
    if (!ci) return false
    const n = (course.name || '').toLowerCase()
    const c = (course.code || '').toLowerCase()
    return ci.includes(n) || (n && n.includes(ci)) || (c && (ci === c || ci.includes(c)))
  }

  const activeCourses = courses.filter((c: any) => c.is_active !== false)

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="Leads"
        title="Leads by course"
        description="Pick a programme to see every lead interested in it. A page is created automatically for each course you add."
      />

      {loading ? <Spinner /> : activeCourses.length === 0 ? (
        <EmptyState icon={<GraduationCap size={20} />} title="No courses yet"
          description={isAdmin ? "Create a course first — its lead page appears here automatically." : "No course pages are available yet. Your administrator will set these up."}
          action={isAdmin ? <Link href="/admin/courses" className="inline-flex items-center gap-1.5 h-10 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-medium"><Plus size={15} /> Add a course</Link> : undefined} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeCourses.map((course: any) => {
            const mine = leads.filter((l: any) => matchesCourse(l.course_interest, course))
            const registered = mine.filter((l: any) => l.status === 'registered').length
            return (
              <Link key={course.id} href={`/admin/leads/course/${encodeURIComponent(course.code || course.name)}`}>
                <Card hover className="p-5 h-full">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-11 h-11 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
                      <GraduationCap size={20} />
                    </div>
                    <ArrowRight size={16} className="text-[var(--ink-faint)]" />
                  </div>
                  <div className="font-semibold text-[var(--ink)] mb-1">{course.name}</div>
                  {course.code && <div className="text-[12px] text-[var(--ink-faint)] mb-3">{course.code}</div>}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge tone="accent">{mine.length} lead{mine.length === 1 ? '' : 's'}</Badge>
                    {registered > 0 && <Badge tone="success">{registered} registered</Badge>}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
