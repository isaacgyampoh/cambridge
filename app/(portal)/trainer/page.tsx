'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Batch, Profile } from '@/types'
import { toast } from 'sonner'
import { GraduationCap, Users, CheckSquare, BookOpen } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default function TrainerDashboard() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [students, setStudents] = useState<Profile[]>([])
  const [attendance, setAttendance] = useState<Record<string, string>>({})
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const sb = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return
      const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p)
      const { data: b } = await sb.from('batches').select('*, courses(*)').eq('trainer_id', user.id).in('status', ['upcoming','ongoing'])
      setBatches(b || [])
      setLoading(false)
    }
    load()
  }, [])

  async function loadStudents(batchId: string) {
    setSelected(batchId)
    const { data: enrollments } = await sb.from('batch_students').select('*, student:student_id(*)').eq('batch_id', batchId)
    setStudents((enrollments || []).map((e: any) => e.student).filter(Boolean))

    // Load existing attendance for this date
    const { data: existing } = await sb.from('attendance').select('*').eq('batch_id', batchId).eq('date', attendanceDate)
    const map: Record<string, string> = {}
    ;(existing || []).forEach(a => { map[a.student_id] = a.status })
    setAttendance(map)
  }

  async function saveAttendance() {
    if (!selected || !profile) return
    setSaving(true)
    const records = students.map(s => ({
      batch_id: selected,
      student_id: s.id,
      date: attendanceDate,
      status: attendance[s.id] || 'present',
      recorded_by: profile.id,
    }))

    // Upsert attendance
    const { error } = await sb.from('attendance').upsert(records, { onConflict: 'batch_id,student_id,date' })
    if (error) { toast.error('Failed to save attendance'); setSaving(false); return }
    toast.success(`Attendance saved for ${records.length} students!`)
    setSaving(false)
  }

  return (
    <div className="fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Trainer Portal</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your classes and record attendance</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* My batches */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-gray-700">My Classes</h2>
            {batches.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400">
                <GraduationCap size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No classes assigned</p>
              </div>
            ) : batches.map(b => (
              <button key={b.id} onClick={() => loadStudents(b.id)}
                className={`w-full text-left bg-white rounded-2xl border-2 p-4 transition ${selected === b.id ? 'border-blue-600' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
                    <BookOpen size={18} className="text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-900 truncate">{b.name}</div>
                    <div className="text-xs text-gray-500">{(b as any).courses?.name}</div>
                    {b.start_date && <div className="text-xs text-gray-400">{formatDate(b.start_date)}</div>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Attendance */}
          <div className="lg:col-span-2">
            {!selected ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
                <CheckSquare size={40} className="mx-auto mb-3 opacity-30" />
                <p>Select a class to take attendance</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-gray-900">Attendance — {students.length} students</h2>
                  <input type="date" value={attendanceDate} onChange={e => { setAttendanceDate(e.target.value); loadStudents(selected) }}
                    className="h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
                </div>

                {students.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 text-sm">No students enrolled in this batch</p>
                ) : (
                  <>
                    <div className="space-y-2 mb-4">
                      {students.map(s => (
                        <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                              {s.full_name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-gray-900">{s.full_name}</div>
                              <div className="text-xs text-gray-400">{s.phone}</div>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {[
                              { key: 'present', label: 'P', color: 'bg-green-500' },
                              { key: 'absent', label: 'A', color: 'bg-red-500' },
                              { key: 'late', label: 'L', color: 'bg-yellow-500' },
                              { key: 'excused', label: 'E', color: 'bg-blue-500' },
                            ].map(opt => (
                              <button key={opt.key}
                                onClick={() => setAttendance({ ...attendance, [s.id]: opt.key })}
                                className={`w-8 h-8 rounded-lg text-xs font-bold text-white transition ${
                                  (attendance[s.id] || 'present') === opt.key ? opt.color : 'bg-gray-200 text-gray-600'
                                }`}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={saveAttendance} disabled={saving}
                      className="w-full h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition">
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
