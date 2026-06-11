'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Profile, Course } from '@/types'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function NewInvoice() {
  const router = useRouter()
  const [students, setStudents] = useState<Profile[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ student_id: '', course_id: '', total_amount: '', due_date: '', notes: '' })
  const sb = createClient()

  useEffect(() => {
    async function load() {
      const [{ data: s }, { data: c }] = await Promise.all([
        sb.from('profiles').select('*').eq('role', 'student').eq('is_active', true).order('full_name'),
        sb.from('courses').select('*').eq('is_active', true).order('name'),
      ])
      setStudents(s || []); setCourses(c || [])
    }
    load()
  }, [])

  async function save() {
    if (!form.student_id || !form.total_amount) { toast.error('Fill required fields'); return }
    setSaving(true)
    const { data: { user } } = await sb.auth.getUser()
    const { error } = await sb.from('invoices').insert({
      student_id: form.student_id,
      course_id: form.course_id || null,
      total_amount: parseFloat(form.total_amount),
      due_date: form.due_date || null,
      notes: form.notes || null,
      created_by: user?.id,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Invoice created!')
    router.push('/finance/invoices')
  }

  return (
    <div className="fade-in w-full">
      <Link href="/finance/invoices" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-5 transition">
        <ArrowLeft size={16} /> Back to invoices
      </Link>
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h1 className="text-lg font-bold text-gray-900 mb-5">Create Invoice</h1>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Student *</label>
            <select value={form.student_id} onChange={e => setForm({ ...form, student_id: e.target.value })}
              className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-blue-500">
              <option value="">Select student...</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Course</label>
            <select value={form.course_id} onChange={e => {
              const c = courses.find(x => x.id === e.target.value)
              setForm({ ...form, course_id: e.target.value, total_amount: c ? String(c.course_fee) : form.total_amount })
            }}
              className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-blue-500">
              <option value="">Select course (optional)...</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name} — GHS {c.course_fee}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Amount (GHS) *</label>
            <input type="number" step="0.01" min="0" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })}
              placeholder="0.00" className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Due Date</label>
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
              className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving}
            className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition">
            {saving ? 'Creating...' : 'Create Invoice'}
          </button>
          <Link href="/finance/invoices" className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition flex items-center justify-center">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  )
}
