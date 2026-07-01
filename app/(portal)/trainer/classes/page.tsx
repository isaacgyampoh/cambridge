'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { toast } from 'sonner'
import { BookOpen, CheckSquare } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default function TrainerClasses() {
  const [myId, setMyId] = useState<string|null>(null)
  const [selected, setSelected] = useState<string|null>(null)
  const [attendance, setAttendance] = useState<Record<string,string>>({})
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0,10))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => { if (s.valid) setMyId(s.userId) })
  }, [])

  const { data: batches, loading } = useData({
    table: 'batches',
    select: '*, courses(*)',
    filters: myId ? [{ col: 'trainer_id', op: 'eq', val: myId }, { col: 'status', op: 'in', val: ['upcoming','ongoing'] }] : [],
    enabled: !!myId,
  })

  const { data: enrollments } = useData({
    table: 'batch_students',
    select: '*, student:student_id(id, full_name, phone)',
    filters: selected ? [{ col: 'batch_id', op: 'eq', val: selected }] : [],
    enabled: !!selected,
  })

  const { data: existingAttendance, refetch: refetchAtt } = useData({
    table: 'attendance',
    select: '*',
    filters: selected ? [{ col: 'batch_id', op: 'eq', val: selected }, { col: 'date', op: 'eq', val: attendanceDate }] : [],
    enabled: !!selected,
  })

  useEffect(() => {
    const map: Record<string,string> = {}
    existingAttendance.forEach(a => { map[a.student_id] = a.status })
    setAttendance(map)
  }, [existingAttendance.length, selected, attendanceDate])

  const students = enrollments.map((e: any) => e.student).filter(Boolean)

  async function saveAttendance() {
    if (!selected || !myId) return
    setSaving(true)
    try {
      const records = students.map((s: any) => ({
        batch_id: selected, student_id: s.id, date: attendanceDate,
        status: attendance[s.id] || 'present', recorded_by: myId,
      }))
      await mutate('POST', 'attendance', records, undefined, { upsert: true, onConflict: 'batch_id,student_id,date' })
      toast.success(`Attendance saved for ${records.length} students!`)
      refetchAtt()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const ATT_OPTS = [
    { key: 'present', label: 'P', color: 'bg-[var(--ok)]' },
    { key: 'absent', label: 'A', color: 'bg-red-500' },
    { key: 'late', label: 'L', color: 'bg-yellow-500' },
    { key: 'excused', label: 'E', color: 'bg-[var(--accent)]' },
  ]

  return (
    <div className="fade-in w-full">
      <div className="mb-8">
        <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">Teaching</div>
        <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">Trainer portal</h1>
        <p className="text-[var(--ink-soft)] text-sm mt-1.5">Manage your classes and record attendance.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Batch list */}
          <div className="space-y-2">
            <h2 className="text-xs font-bold text-[var(--ink-faint)] uppercase tracking-wide">My Classes</h2>
            {batches.length === 0 ? (
              <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-8 text-center text-[var(--ink-faint)] text-sm">No classes assigned</div>
            ) : batches.map(b => (
              <button key={b.id} onClick={() => setSelected(b.id)}
                className={`w-full text-left bg-[var(--paper)] rounded-xl border-2 p-4 transition ${selected===b.id?'border-blue-600':'border-[var(--line-soft)] hover:border-[var(--line)]'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center">
                    
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--ink)] truncate">{b.name}</div>
                    <div className="text-xs text-[var(--ink-faint)]">{(b as any).courses?.name}</div>
                    {b.start_date && <div className="text-xs text-[var(--ink-faint)]">{formatDate(b.start_date)}</div>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Attendance */}
          <div className="lg:col-span-2">
            {!selected ? (
              <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-16 text-center text-[var(--ink-faint)]">
                
                <p>Select a class to take attendance</p>
              </div>
            ) : (
              <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[var(--ink)]">Attendance — {students.length} students</h2>
                  <input type="date" value={attendanceDate} onChange={e => setAttendanceDate(e.target.value)}
                    className="h-9 px-3 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
                </div>

                <div className="flex gap-2 mb-3 text-[10px] font-bold text-[var(--ink-faint)]">
                  {ATT_OPTS.map(o => (
                    <span key={o.key} className="flex items-center gap-1">
                      <span className={`w-3 h-3 rounded-sm ${o.color}`} />{o.key}
                    </span>
                  ))}
                </div>

                {students.length === 0 ? (
                  <p className="text-center text-[var(--ink-faint)] py-8 text-sm">No students enrolled</p>
                ) : (
                  <>
                    <div className="space-y-2 mb-4">
                      {students.map((s: any) => (
                        <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-[var(--line-soft)]">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
                              {s.full_name?.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-[var(--ink)]">{s.full_name}</div>
                              {s.phone && <div className="text-[12px] text-[var(--ink-faint)]">{s.phone}</div>}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {ATT_OPTS.map(opt => (
                              <button key={opt.key}
                                onClick={() => setAttendance(a => ({...a, [s.id]: opt.key}))}
                                className={`w-8 h-8 rounded-lg text-xs font-bold text-white transition ${(attendance[s.id]||'present')===opt.key?opt.color:'bg-[var(--line)] text-[var(--ink-faint)] hover:bg-[var(--line)]'}`}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={saveAttendance} disabled={saving}
                      className="w-full h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">
                      {saving ? 'Saving...' : 'Save Attendance'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
