'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import type { Batch, Course, Profile } from '@/types'
import { toast } from 'sonner'
import { Plus, X, GraduationCap } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default function ClassesPage() {
  const { data: batches, loading, refetch: load } = useData<Batch>({
    table: 'batches', select: '*, courses(*), trainer:profiles!trainer_id(full_name)',
    orderBy: 'start_date', orderAsc: false, limit: 200,
  })
  const { data: courses } = useData<Course>({
    table: 'courses', filters: [{ col: 'is_active', op: 'eq', val: true }], orderBy: 'name', limit: 200,
  })
  const { data: trainers } = useData<Profile>({
    table: 'profiles', filters: [{ col: 'role', op: 'eq', val: 'trainer' }, { col: 'is_active', op: 'eq', val: true }], orderBy: 'full_name', limit: 200,
  })
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<any>({
    name: '', course_id: '', trainer_id: '', class_type: 'physical', status: 'upcoming',
    start_date: '', end_date: '', schedule: '', venue: '', zoom_link: '', max_students: 30,
  })

  async function save() {
    if (!form.name || !form.course_id) { toast.error('Name and course are required'); return }
    setSaving(true)
    try {
      await mutate('POST', 'batches', {
        ...form,
        trainer_id: form.trainer_id || null,
        zoom_link: form.zoom_link || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      })
      toast.success('Batch created!'); setModal(false); load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to create batch')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await mutate('PATCH', 'batches', { status }, [{ col: 'id', val: id }])
      load()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status')
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    upcoming: 'bg-blue-100 text-blue-700',
    ongoing: 'bg-green-100 text-green-700',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-600',
  }

  return (
    <div className="fade-in w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Classes & Batches</h1>
          <p className="text-gray-500 text-sm mt-0.5">{batches.length} batches</p>
        </div>
        <button onClick={() => setModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
          <Plus size={16} /> New Batch
        </button>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto p-4 flex items-start sm:items-center justify-center">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md my-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">New Batch</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              {[
                { key: 'name', label: 'Batch Name *', type: 'text', placeholder: 'PMP March 2025' },
                { key: 'start_date', label: 'Start Date', type: 'date', placeholder: '' },
                { key: 'end_date', label: 'End Date', type: 'date', placeholder: '' },
                { key: 'schedule', label: 'Schedule', type: 'text', placeholder: 'Mon/Wed/Fri 9am–12pm' },
                { key: 'venue', label: 'Venue', type: 'text', placeholder: 'Cambridge Accra Campus' },
                { key: 'zoom_link', label: 'Zoom Link (if online)', type: 'url', placeholder: 'https://zoom.us/j/...' },
                { key: 'max_students', label: 'Max Students', type: 'number', placeholder: '30' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: f.type === 'number' ? parseInt(e.target.value) : e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              ))}
              {[
                { key: 'course_id', label: 'Course *', opts: courses.map(c => ({ v: c.id, l: c.name })) },
                { key: 'trainer_id', label: 'Trainer', opts: trainers.map(t => ({ v: t.id, l: t.full_name })) },
                { key: 'class_type', label: 'Type', opts: [{ v: 'physical', l: 'Physical' }, { v: 'online', l: 'Online' }] },
                { key: 'status', label: 'Status', opts: [{ v: 'upcoming', l: 'Upcoming' }, { v: 'ongoing', l: 'Ongoing' }] },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{f.label}</label>
                  <select value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-blue-500">
                    <option value="">Select...</option>
                    {f.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={save} disabled={saving}
                className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Batch'}
              </button>
              <button onClick={() => setModal(false)} className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch list */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
      ) : (
        <div className="space-y-3">
          {batches.map(b => {
            const course = (b as any).courses
            const trainer = (b as any).trainer
            return (
              <div key={b.id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <GraduationCap size={20} className="text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{b.name}</h3>
                      <p className="text-sm text-gray-500">{course?.name}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        {b.start_date && <span>📅 {formatDate(b.start_date)}</span>}
                        {b.schedule && <span>🕐 {b.schedule}</span>}
                        {trainer && <span>👤 {trainer.full_name}</span>}
                        {b.venue && <span>📍 {b.venue}</span>}
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${b.class_type === 'online' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                          {b.class_type}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={b.status} onChange={e => updateStatus(b.id, e.target.value)}
                      className={`text-xs font-bold px-3 py-1 rounded-full border-0 ${STATUS_COLORS[b.status]} focus:outline-none cursor-pointer`}>
                      {['upcoming','ongoing','completed','cancelled'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )
          })}
          {batches.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center text-gray-400">
              <GraduationCap size={40} className="mx-auto mb-3 opacity-30" />
              <p>No batches yet. Create your first class batch.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
