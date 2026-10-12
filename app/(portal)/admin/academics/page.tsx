'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { ManualRegistrationDialog } from '@/components/academics/ManualRegistrationDialog'
import { readableStatus } from '@/lib/ui/status'
import { PageHeader, Card, StatCard, Spinner, Badge, SectionLabel, Button } from '@/components/ui'
import Link from 'next/link'
import type { Batch, Course, StudentFee } from '@/types'

export default function AcademicsHub() {
  const { data: courses, loading: lc } = useData<Course>({ table: 'courses', limit: 200 })
  const { data: batches, loading: lb, refetch: refetchBatches } = useData<Batch>({ table: 'batches', select: '*, courses(name)', orderBy: 'created_at', orderAsc: false, limit: 200 })
  const [registering, setRegistering] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')

  /*
   * The students themselves, read from the fee ledger.
   *
   * student_fees is the canonical record of a registered student — it is what
   * the accountant's screen reads, and what an online registration creates.
   * Reading the same table here means the academic department and Accounts
   * are looking at one list, not two that can disagree.
   *
   * project_manager and accountant both hold it in lib/data/policy, and
   * project_manager holds the `academics` portal that grants this page, so
   * this one list serves the academic department and the PM without a second
   * screen.
   */
  const { data: students, loading: ls, refetch: refetchStudents } = useData<StudentFee>({
    table: 'student_fees', select: '*', orderBy: 'created_at', orderAsc: false, limit: 500,
  })

  const loading = lc || lb
  const activeCourses = courses.filter((c) => c.is_active)
  const owingCount = students.filter(st => Number(st.balance) > 0).length
  const shownStudents = studentSearch
    ? students.filter(st => (st.student_name || '').toLowerCase().includes(studentSearch.toLowerCase()))
    : students
  const ongoing = batches.filter((b) => b.status === 'ongoing')
  const upcoming = batches.filter((b) => b.status === 'upcoming')

  const STATUS: Record<string, any> = {
    upcoming: 'accent', ongoing: 'success', completed: 'muted', cancelled: 'danger',
  }

  return (
    <div className="fade-in w-full max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Academics"
        title="Programmes & Classes"
        description="Manage your course catalogue and the class batches running against it."
        actions={
          <>
            <Button variant="secondary" href="/admin/courses" >Courses</Button>
            <Button variant="secondary" href="/admin/classes" >Classes</Button>
            {/*
              The primary action on this page. Students signed up at the desk
              never reach the online form, so without this there is no way to
              put them into the records the accountant reads.
            */}
            <Button onClick={() => setRegistering(true)}>Register Student Manually</Button>
          </>
        }
      />

      <ManualRegistrationDialog
        open={registering}
        onClose={() => setRegistering(false)}
        courses={courses}
        batches={batches}
        /*
         * Reload from the server rather than pushing the new student into
         * local state: the record the list should show is the one that was
         * actually saved, including everything the canonical path filled in.
         */
        onRegistered={() => { refetchStudents(); refetchBatches() }}
      />

      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <StatCard label="Active courses" value={activeCourses.length} sub={`${courses.length} total`}  />
            <StatCard label="Ongoing classes" value={ongoing.length}  accent />
            <StatCard label="Upcoming" value={upcoming.length} sub="Scheduled to begin"  />
            <StatCard label="Registered students" value={students.length} sub={owingCount ? `${owingCount} owing` : 'all settled'} />
          </div>

          {/* ── Registered students ───────────────────────────────────────
              The same rows the accountant sees, so the two departments are
              never looking at different lists. */}
          <div className="mb-10">
            <div className="flex items-center justify-between gap-3 mb-4">
              <SectionLabel>Registered students</SectionLabel>
              <input
                className="h-9 px-3 rounded-lg border border-[var(--line)] bg-[var(--paper)] text-[16px] sm:text-[13px] w-full max-w-[220px]
                  focus:outline-none focus:border-[var(--accent)]"
                placeholder="Search by name"
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
                aria-label="Search registered students"
              />
            </div>

            {ls ? <Spinner /> : shownStudents.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-sm text-[var(--ink-soft)]">
                  {studentSearch
                    ? `Nobody matching “${studentSearch}”.`
                    : 'No students registered yet. Use Register Student Manually for anyone signed up at the desk.'}
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {shownStudents.slice(0, 50).map(st => (
                  <Card key={st.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--ink)] truncate">{st.student_name || 'Unnamed'}</div>
                        <div className="text-[12px] text-[var(--ink-soft)] mt-0.5 truncate">
                          {st.course_name || 'No programme recorded'}
                          {st.delivery ? ` · ${st.delivery === 'online' ? 'Online' : 'In person'}` : ''}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <Badge tone={Number(st.balance) > 0 ? 'danger' : 'success'}>
                          {Number(st.balance) > 0 ? `GHS ${Number(st.balance).toLocaleString()} owing` : 'Paid'}
                        </Badge>
                        <div className="text-[11px] text-[var(--ink-faint)] mt-1">
                          {`GHS ${Number(st.amount_paid || 0).toLocaleString()} of ${Number(st.total_fee || 0).toLocaleString()}`}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
                {shownStudents.length > 50 && (
                  <p className="text-[12px] text-[var(--ink-faint)] pt-1">
                    + {shownStudents.length - 50} more. Accounts has the full list under Finance → Student fees.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Two columns: courses + active batches */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Course catalogue */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <SectionLabel>Course catalogue</SectionLabel>
                <Link href="/admin/courses" className="text-[12px] font-medium text-[var(--accent)] hover:underline flex items-center gap-1 mb-4">
                  Manage 
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
                          <div className="text-[12px] text-[var(--ink-faint)]">course fee</div>
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
                  Manage 
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
                        <Badge tone={STATUS[b.status] || 'neutral'}>{readableStatus(b.status)}</Badge>
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
