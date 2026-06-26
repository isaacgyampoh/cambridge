'use client'
import { useState, useEffect } from 'react'
import { useData } from '@/hooks/useData'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import { Users, Phone, PhoneCall } from 'lucide-react'

export default function MarketerAttendance() {
  const { data: batches } = useData<any>({ table: 'batches', select: '*, courses(name)', orderBy: 'created_at', orderAsc: false, limit: 100 })
  const [batchId, setBatchId] = useState('')
  const [att, setAtt] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const active = (batches || []).filter((b: any) => b.status !== 'completed' && b.status !== 'cancelled')

  useEffect(() => { if (!batchId && active.length) setBatchId(active[0].id) }, [active])
  useEffect(() => {
    if (!batchId) return
    setLoading(true)
    fetch(`/api/classes/attendance?batchId=${batchId}`).then(r => r.json())
      .then(d => { if (!d.error) setAtt(d) }).finally(() => setLoading(false))
  }, [batchId])

  return (
    <div className="fade-in w-full max-w-2xl">
      <PageHeader
        eyebrow="My students"
        title="Class attendance"
        description="See which of your students came to class today, and who to call."
      />

      <select value={batchId} onChange={e => setBatchId(e.target.value)} className={inputClass + ' mb-5 max-w-sm'}>
        <option value="">Select a class…</option>
        {active.map((b: any) => <option key={b.id} value={b.id}>{b.name} {b.courses?.name ? `· ${b.courses.name}` : ''}</option>)}
      </select>

      {loading ? <Spinner /> : !att ? (
        <EmptyState icon={<Users size={20} />} title="Pick a class" description="Choose a class above to see your students' attendance." />
      ) : att.students.length === 0 ? (
        <EmptyState icon={<Users size={20} />} title="No students of yours in this class" description="You have no registered students enrolled in this class." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl bg-[var(--ok-soft)] p-4 text-center">
              <div className="font-display text-2xl font-semibold text-[var(--ok)]">{att.presentCount}</div>
              <div className="text-[12px] text-[var(--ink-soft)]">Came</div>
            </div>
            <div className="rounded-xl bg-[var(--warn-soft)] p-4 text-center">
              <div className="font-display text-2xl font-semibold text-[var(--warn)]">{att.absentCount}</div>
              <div className="text-[12px] text-[var(--ink-soft)]">Absent — call them</div>
            </div>
            <div className="rounded-xl bg-[var(--canvas)] p-4 text-center">
              <div className="font-display text-2xl font-semibold text-[var(--ink)]">{att.total}</div>
              <div className="text-[12px] text-[var(--ink-soft)]">Your students</div>
            </div>
          </div>

          {att.absentCount > 0 && (
            <p className="text-sm font-medium text-[var(--ink)] mb-2">Absent students to call</p>
          )}
          <Card className="overflow-hidden">
            <div className="divide-y divide-[var(--line-soft)]">
              {att.students.sort((a: any, b: any) => Number(a.present) - Number(b.present)).map((s: any) => (
                <div key={s.enrollmentId} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">{s.name}</div>
                    {s.phone && <div className="text-[12px] text-[var(--ink-faint)]">{String(s.phone).replace(/^233/, '0')}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!s.present && s.phone && (
                      <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-medium">
                        <PhoneCall size={13} /> Call
                      </a>
                    )}
                    <Badge tone={s.present ? 'success' : 'neutral'}>{s.present ? 'Present' : 'Absent'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
