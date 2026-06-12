'use client'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, StatCard, Spinner, Badge, SectionLabel, Button } from '@/components/ui'
import { BookOpen, GraduationCap, CalendarCheck, Users, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function AcademicsHub() {
  const { data: courses, loading: lc } = useData<any>({ table: 'courses', limit: 200 })
  const { data: batches, loading: lb } = useData<any>({ table: 'batches', select: '*, courses(name)', orderBy: 'created_at', orderAsc: false, limit: 200 })

  const loading = lc || lb
  const activeCourses = courses.filter((c: any) => c.is_active)
  const ongoing = batches.filter((b: any) => b.status === 'ongoing')
  const upcoming = batches.filter((b: any) => b.status === 'upcoming')

  const STATUS: Record<string, any> = {
    upcoming: 'accent', ongoing: 'success', completed: 'muted', cancelled: 'danger',
  }

  return (
    <div className="fade-in max-w-6xl">
      <PageHeader
        eyebrow="Academics"
        title="Programmes & Classes"
        description="Manage your course catalogue and the class batches running against it."
        actions={
          <>
            <Button variant="secondary" href="/admin/courses" icon={<BookOpen size={15} />}>Courses</Button>
            <Button href="/admin/classes" icon={<GraduationCap size={15} />}>Classes</Button>
          </>
        }
      />

      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <StatCard label="Active courses" value={activeCourses.length} sub={`${courses.length} total`} icon={<BookOpen size={18} />} />
            <StatCard label="Ongoing classes" value={ongoing.length} icon={<CalendarCheck size={18} />} accent />
            <StatCard label="Upcoming" value={upcoming.length} sub="Scheduled to begin" icon={<CalendarCheck size={18} />} />
            <StatCard label="All batches" value={batches.length} icon={<GraduationCap size={18} />} />
          </div>

          {/* Two columns: courses + active batches */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Course catalogue */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <SectionLabel>Course catalogue</SectionLabel>
                <Link href="/admin/courses" className="text-[12px] font-medium text-[var(--accent)] hover:underline flex items-center gap-1 mb-4">
                  Manage <ArrowRight size={12} />
                </Link>
              </div>
              {activeCourses.length === 0 ? (
                <Card className="p-8 text-center">
                  <p className="text-sm text-[var(--ink-soft)] mb-4">No courses yet. Add your first programme to begin.</p>
                  <Button href="/admin/courses" size="sm">Add a course</Button>
                </Card>
              ) : (
                <div className="space-y-2 stagger">
                  {activeCourses.slice(0, 6).map((c: any) => (
                    <Link key={c.id} href="/admin/courses">
                      <Card hover className="p-4 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--ink)] truncate">{c.name}</div>
                          <div className="text-xs text-[var(--ink-faint)] mt-0.5">
                            {c.code && <span className="font-mono">{c.code}</span>}
                            {c.duration && <span>{c.code ? ' · ' : ''}{c.duration}</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-4">
                          <div className="text-sm font-semibold text-[var(--ink)]">GHS {Number(c.course_fee || 0).toLocaleString()}</div>
                          <div className="text-[11px] text-[var(--ink-faint)]">course fee</div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Active batches */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <SectionLabel>Current & upcoming classes</SectionLabel>
                <Link href="/admin/classes" className="text-[12px] font-medium text-[var(--accent)] hover:underline flex items-center gap-1 mb-4">
                  Manage <ArrowRight size={12} />
                </Link>
              </div>
              {[...ongoing, ...upcoming].length === 0 ? (
                <Card className="p-8 text-center">
                  <p className="text-sm text-[var(--ink-soft)] mb-4">No classes scheduled. Create a batch from a course.</p>
                  <Button href="/admin/classes" size="sm">Create a class</Button>
                </Card>
              ) : (
                <div className="space-y-2 stagger">
                  {[...ongoing, ...upcoming].slice(0, 6).map((b: any) => (
                    <Link key={b.id} href="/admin/classes">
                      <Card hover className="p-4 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--ink)] truncate">{b.name}</div>
                          <div className="text-xs text-[var(--ink-faint)] mt-0.5 truncate">{b.courses?.name}</div>
                        </div>
                        <Badge tone={STATUS[b.status] || 'neutral'}>{b.status}</Badge>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
