'use client'
import { useState, useEffect } from 'react'
import { useData, mutate } from '@/hooks/useData'
import { useRouter } from 'next/navigation'
import type { Profile, Course } from '@/types'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function NewInvoice() {
  const router = useRouter()
  const { data: students } = useData<Profile>({
    table: 'profiles', filters: [{ col: 'role', op: 'eq', val: 'student' }, { col: 'is_active', op: 'eq', val: true }], orderBy: 'full_name', limit: 500,
  })
  const { data: courses } = useData<Course>({
    table: 'courses', filters: [{ col: 'is_active', op: 'eq', val: true }], orderBy: 'name', limit: 200,
  })
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [form, setForm] = useState({ student_id: '', course_id: '', total_amount: '', due_date: '', notes: '' })

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(s => setUserId(s?.userId || null)).catch(() => {})
  }, [])

  async function save() {
    if (!form.student_id || !form.total_amount) { toast.error('Fill required fields'); return }
    setSaving(true)
    try {
      await mutate('POST', 'invoices', {
        student_id: form.student_id,
        course_id: form.course_id || null,
        total_amount: parseFloat(form.total_amount),
        due_date: form.due_date || null,
        notes: form.notes || null,
        created_by: userId,
      })
      toast.success('Invoice created!')
      router.push('/finance')
    } catch (e: any) {
      toast.error(e.message || 'Failed to create invoice')
      setSaving(false)
    }
  }

  return (
    <div className="fade-in w-full">
      <Link href="/finance" className="inline-flex items-center gap-2 text-sm text-[var(--ink-faint)] hover:text-[var(--ink)] mb-5 transition">
         Back to invoices
      </Link>
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] p-6">
        <h1 className="font-semibold text-[var(--ink)] mb-5">Create Invoice</h1>
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Student *</label>
            <select value={form.student_id} onChange={e => setForm({ ...form, student_id: e.target.value })}
              className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">Select student...</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Course</label>
            <select value={form.course_id} onChange={e => {
              const c = courses.find(x => x.id === e.target.value)
              setForm({ ...form, course_id: e.target.value, total_amount: c ? String(c.course_fee) : form.total_amount })
            }}
              className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">Select course (optional)...</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name} — GHS {c.course_fee}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Amount (GHS) *</label>
            <input type="number" step="0.01" min="0" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })}
              placeholder="0.00" className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Due Date</label>
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
              className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full px-4 py-3 rounded-xl border border-[var(--line)] text-sm resize-none focus:outline-none focus:border-[var(--accent)]" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving}
            className="flex-1 h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:brightness-110 transition">
            {saving ? 'Creating...' : 'Create Invoice'}
          </button>
          <Link href="/finance" className="flex-1 h-11 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition flex items-center justify-center">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  )
}
