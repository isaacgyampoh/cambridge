'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Course } from '@/types'
import { toast } from 'sonner'
import { Plus, X, BookOpen } from 'lucide-react'
import { formatGHS } from '@/lib/utils'

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [editing, setEditing] = useState<Partial<Course> | null>(null)
  const [saving, setSaving] = useState(false)
  const sb = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await sb.from('courses').select('*').order('name')
    setCourses(data || [])
    setLoading(false)
  }

  function openNew() {
    setEditing({ name: '', code: '', description: '', duration: '', course_fee: 0, registration_fee: 200, is_active: true })
    setModal('new')
  }

  function openEdit(c: Course) {
    setEditing({ ...c })
    setModal('edit')
  }

  async function save() {
    if (!editing?.name) { toast.error('Course name is required'); return }
    setSaving(true)
    const { id, ...data } = editing as any
    const { error } = modal === 'new'
      ? await sb.from('courses').insert(data)
      : await sb.from('courses').update(data).eq('id', id)
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(modal === 'new' ? 'Course created!' : 'Course updated!')
    setModal(null); setEditing(null); setSaving(false)
    load()
  }

  async function toggle(id: string, active: boolean) {
    await sb.from('courses').update({ is_active: !active }).eq('id', id)
    load()
  }

  const fields = [
    { key: 'name', label: 'Course Name *', placeholder: 'PMP Certification', type: 'text' },
    { key: 'code', label: 'Code', placeholder: 'PMP-001', type: 'text' },
    { key: 'duration', label: 'Duration', placeholder: '3 months', type: 'text' },
    { key: 'course_fee', label: 'Course Fee (GHS)', placeholder: '2000', type: 'number' },
    { key: 'registration_fee', label: 'Registration Fee (GHS)', placeholder: '200', type: 'number' },
  ]

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Courses</h1>
          <p className="text-gray-500 text-sm mt-0.5">{courses.length} courses</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
          <Plus size={16} /> Add Course
        </button>
      </div>

      {/* Modal */}
      {modal && editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">{modal === 'new' ? 'New Course' : 'Edit Course'}</h2>
              <button onClick={() => { setModal(null); setEditing(null) }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              {fields.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={(editing as any)[f.key] || ''}
                    onChange={e => setEditing({ ...editing, [f.key]: f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
                    className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Description</label>
                <textarea value={(editing as any).description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={save} disabled={saving}
                className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition">
                {saving ? 'Saving...' : 'Save Course'}
              </button>
              <button onClick={() => { setModal(null); setEditing(null) }}
                className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map(c => (
            <div key={c.id} className={`bg-white rounded-2xl border-2 p-5 transition ${c.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <BookOpen size={20} className="text-blue-600" />
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <h3 className="font-bold text-gray-900 mb-0.5">{c.name}</h3>
              {c.code && <p className="text-xs text-gray-400 font-mono mb-2">{c.code}</p>}
              {c.description && <p className="text-xs text-gray-500 mb-3 line-clamp-2">{c.description}</p>}
              <div className="space-y-1 text-xs text-gray-600 mb-4">
                {c.duration && <div>Duration: <span className="font-semibold">{c.duration}</span></div>}
                <div>Course Fee: <span className="font-semibold text-gray-900">{formatGHS(c.course_fee)}</span></div>
                <div>Reg. Fee: <span className="font-semibold">{formatGHS(c.registration_fee)}</span></div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(c)} className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-200 transition">Edit</button>
                <button onClick={() => toggle(c.id, c.is_active)} className="px-3 py-2 bg-gray-50 text-gray-500 rounded-xl text-xs font-semibold hover:bg-gray-100 transition">
                  {c.is_active ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
          {courses.length === 0 && (
            <div className="col-span-3 text-center py-16 text-gray-400">
              <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
              <p>No courses yet. Add your first course.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
