'use client'
import { useState, useEffect } from 'react'
import { PageHeader, Card, Badge, Spinner, EmptyState, inputClass } from '@/components/ui'
import { Activity, MessageSquare, Pencil, UserPlus, UserMinus } from 'lucide-react'

const ACTION_META: Record<string, { icon: any; tone: string; label: string }> = {
  added:   { icon: UserPlus,      tone: 'success', label: 'Added' },
  updated: { icon: Pencil,        tone: 'accent',  label: 'Updated' },
  comment: { icon: MessageSquare, tone: 'neutral', label: 'Comment' },
  removed: { icon: UserMinus,     tone: 'warning', label: 'Removed' },
}

export default function PrepActivityPage() {
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [program, setProgram] = useState('')

  useEffect(() => {
    setLoading(true)
    const url = program ? `/api/prep/activity?program=${program}` : '/api/prep/activity'
    fetch(url).then(r => r.json()).then(d => setActivity(d.activity || [])).catch(() => {}).finally(() => setLoading(false))
  }, [program])

  const programs = Array.from(new Set(activity.map(a => a.program_code).filter(Boolean)))

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime()
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), days = Math.floor(h / 24)
    if (days > 0) return `${days}d ago`
    if (h > 0) return `${h}h ago`
    if (m > 0) return `${m}m ago`
    return 'just now'
  }

  return (
    <div className="fade-in w-full max-w-3xl">
      <PageHeader eyebrow="Oversight" title="Exam-prep coordinator activity"
        description="Every comment and change the exam-prep coordinators make on student records — across all programmes." />

      <div className="flex gap-2 mb-5">
        <button onClick={() => setProgram('')} className={`text-sm font-medium px-4 h-9 rounded-lg ${!program ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>All programmes</button>
        {programs.map(p => (
          <button key={p} onClick={() => setProgram(p)} className={`text-sm font-medium px-4 h-9 rounded-lg ${program === p ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--line)] text-[var(--ink-soft)]'}`}>{p}</button>
        ))}
      </div>

      {loading ? <Spinner /> : activity.length === 0 ? (
        <EmptyState icon={<Activity size={20} />} title="No activity yet"
          description="When coordinators add students, leave comments, or update records, it shows here." />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-[var(--line-soft)]">
            {activity.map(a => {
              const meta = ACTION_META[a.action] || ACTION_META.updated
              const Icon = meta.icon
              return (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="w-8 h-8 rounded-lg bg-[var(--canvas)] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={15} className="text-[var(--ink-soft)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--ink)]">{a.actor_name || 'Coordinator'}</span>
                      <Badge tone={meta.tone as any}>{meta.label}</Badge>
                      {a.program_code && <span className="text-[11px] text-[var(--ink-faint)]">{a.program_code}</span>}
                    </div>
                    {a.student_name && <div className="text-xs text-[var(--ink-soft)] mt-0.5">Student: {a.student_name}</div>}
                    {a.detail && <div className="text-sm text-[var(--ink-soft)] mt-1">{a.detail}</div>}
                  </div>
                  <span className="text-[11px] text-[var(--ink-faint)] flex-shrink-0">{timeAgo(a.created_at)}</span>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
