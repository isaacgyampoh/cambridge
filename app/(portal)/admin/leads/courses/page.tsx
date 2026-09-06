'use client'
import { useState, useEffect } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Spinner, EmptyState, Badge } from '@/components/ui'
import Link from 'next/link'
import type { Course, Lead } from '@/types'

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

  const { data: courses, loading } = useData<Course>({ table: 'courses', select: 'id, name, code, is_active', orderBy: 'name', orderAsc: true, limit: 200 })
  const { data: leads } = useData<Lead>({ table: 'leads', select: 'id, course_interest, status', limit: 2000 })

  /*
   * `ci` is nullable: a lead can be created with no course of interest, and
   * most imported ones are. The signature said `string`, which the untyped
   * rows let through — the guard below was the only thing stopping it.
   */
  function matchesCourse(ci: string | null | undefined, course: Course): boolean {
    const needle = (ci || '').toLowerCase().trim()
    if (!needle) return false
    return match(needle, course)
  }

  /*
   * Does this lead's stated interest refer to this course?
   *
   * The empty-string guards are not tidiness. `ci.includes('')` is TRUE for
   * every string, so a course saved with no name — or no code — matched every
   * lead in the system and reported the whole pipeline as interested in it.
   * The previous version returned `'' | boolean` and only avoided the bug for
   * `n` by accident of ordering.
   */
  function match(ci: string, course: Course): boolean {
    const name = (course.name || '').toLowerCase().trim()
    const code = (course.code || '').toLowerCase().trim()

    if (name && (ci.includes(name) || name.includes(ci))) return true
    if (code && (ci === code || ci.includes(code))) return true
    return false
  }

  const activeCourses = courses.filter((c) => c.is_active !== false)

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Leads"
        title="Leads by course"
        description="Pick a programme to see every lead interested in it. A page is created automatically for each course you add."
      />

      {loading ? <Spinner /> : activeCourses.length === 0 ? (
        <EmptyState  title="No courses yet"
          description={isAdmin ? "Create a course first — its lead page appears here automatically." : "No course pages are available yet. Your administrator will set these up."}
          action={isAdmin ? <Link href="/admin/courses" className="inline-flex items-center gap-1.5 h-10 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-medium"> Add a course</Link> : undefined} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeCourses.map(course => {
            const mine = leads.filter((l) => matchesCourse(l.course_interest, course))
            const registered = mine.filter(l => l.status === 'registered').length
            return (
              <Link key={course.id} href={`/admin/leads/course/${encodeURIComponent(course.code || course.name)}`}>
                <Card hover className="p-5 h-full">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-11 h-11 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
                      
                    </div>
                    
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
