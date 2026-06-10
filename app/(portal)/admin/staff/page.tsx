'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, UserRole } from '@/types'
import { toast } from 'sonner'
import { Plus, X, Check } from 'lucide-react'

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'marketing_officer', label: 'Marketing Officer' },
  { value: 'admissions_officer', label: 'Admissions Officer' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'trainer', label: 'Trainer' },
  { value: 'super_admin', label: 'Super Admin' },
]

export default function StaffPage() {
  const [staff, setStaff] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: 'marketing_officer' as UserRole, password: '' })
  const [saving, setSaving] = useState(false)
  const sb = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await sb.from('profiles').select('*').order('role').order('full_name')
    setStaff(data || [])
    setLoading(false)
  }

  async function createStaff() {
    if (!form.full_name || !form.email || !form.password) {
      toast.error('Fill in all required fields')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/create-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success('Staff member created!')
      setAdding(false)
      setForm({ full_name: '', email: '', phone: '', role: 'marketing_officer', password: '' })
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    await sb.from('profiles').update({ is_active: !current }).eq('id', id)
    toast.success(current ? 'Staff deactivated' : 'Staff activated')
    load()
  }

  const ROLE_LABELS: Record<string, string> = {
    super_admin: 'Super Admin', project_manager: 'Project Manager',
    marketing_officer: 'Marketing', admissions_officer: 'Admissions',
    accountant: 'Accountant', receptionist: 'Receptionist',
    trainer: 'Trainer', student: 'Student',
  }

  const ROLE_COLORS: Record<string, string> = {
    super_admin: 'bg-purple-100 text-purple-700',
    project_manager: 'bg-blue-100 text-blue-700',
    marketing_officer: 'bg-green-100 text-green-700',
    admissions_officer: 'bg-indigo-100 text-indigo-700',
    accountant: 'bg-yellow-100 text-yellow-700',
    receptionist: 'bg-pink-100 text-pink-700',
    trainer: 'bg-orange-100 text-orange-700',
  }

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">{staff.length} staff members</p>
        </div>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition">
          <Plus size={16} /> Add Staff
        </button>
      </div>

      {/* Add form modal */}
      {adding && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Add Staff Member</h2>
              <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              {[
                { key: 'full_name', label: 'Full Name *', placeholder: 'John Mensah', type: 'text' },
                { key: 'email', label: 'Email *', placeholder: 'john@cambridge.edu.gh', type: 'email' },
                { key: 'phone', label: 'Phone', placeholder: '0241234567', type: 'tel' },
                { key: 'password', label: 'Password *', placeholder: '••••••••', type: 'password' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={(form as any)[f.key]}
                    onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Role *</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 bg-white">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={createStaff} disabled={saving}
                className="flex-1 h-10 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-blue-700 transition flex items-center justify-center gap-2">
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin" /> : <Check size={16} />}
                Create
              </button>
              <button onClick={() => setAdding(false)} className="flex-1 h-10 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Name', 'Email', 'Phone', 'Role', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {s.full_name.charAt(0)}
                        </div>
                        <span className="text-sm font-semibold text-gray-900">{s.full_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.email}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLORS[s.role] || 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABELS[s.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleActive(s.id, s.is_active)}
                        className="text-xs font-semibold text-gray-500 hover:text-blue-600 transition">
                        {s.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
