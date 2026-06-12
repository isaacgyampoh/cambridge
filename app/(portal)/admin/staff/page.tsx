'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import { toast } from 'sonner'
import { Plus, X, Check, Copy, Eye, EyeOff, Shield, Phone, Mail, User, Briefcase, Hash } from 'lucide-react'

const ROLES = [
  { value: 'project_manager',   label: 'Project Manager',    color: 'bg-blue-100 text-blue-700' },
  { value: 'marketing_officer', label: 'Marketing Officer',  color: 'bg-green-100 text-green-700' },
  { value: 'admissions_officer',label: 'Admissions Officer', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'accountant',        label: 'Accountant',         color: 'bg-amber-100 text-amber-700' },
  { value: 'receptionist',      label: 'Receptionist',       color: 'bg-pink-100 text-pink-700' },
  { value: 'trainer',           label: 'Trainer',            color: 'bg-orange-100 text-orange-700' },
  { value: 'super_admin',       label: 'Super Admin',        color: 'bg-purple-100 text-purple-700' },
]

const ROLE_COLOR: Record<string, string> = Object.fromEntries(ROLES.map(r => [r.value, r.color]))
const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES.map(r => [r.value, r.label]))

const EMPTY = { full_name: '', email: '', phone: '', role: 'marketing_officer', initial_pin: '', department: '' }

export default function StaffPage() {
  const [showModal, setShowModal]   = useState(false)
  const [form,      setForm]        = useState({ ...EMPTY })
  const [saving,    setSaving]      = useState(false)
  const [creds,     setCreds]       = useState<any>(null)
  const [showPin,   setShowPin]     = useState(false)
  const [search,    setSearch]      = useState('')

  const { data: staff, loading, refetch } = useData({
    table: 'profiles',
    select: '*',
    orderBy: 'full_name', orderAsc: true,
    filters: [{ col: 'role', op: 'neq', val: 'student' }],
  })

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function openModal() { setForm({ ...EMPTY }); setCreds(null); setShowModal(true) }

  async function createStaff() {
    if (!form.full_name.trim() || !form.phone.trim()) {
      toast.error('Full name and phone number are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/create-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'Failed to create staff')
      toast.success(`✅ ${form.full_name} created!`)
      setCreds(d.credentials)
      setForm({ ...EMPTY })
      refetch()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    await fetch('/api/data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'profiles', data: { is_active: !current }, filters: [{ col: 'id', val: id }] }),
    })
    toast.success(current ? 'Deactivated' : 'Activated')
    refetch()
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied!`)
  }

  const filtered = staff.filter(s =>
    !search || s.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase()) ||
    s.phone?.includes(search)
  )

  const byRole = ROLES.map(r => ({ ...r, count: staff.filter(s => s.role === r.value).length }))

  return (
    <div className="fade-in w-full">

      {/* ── Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Add Staff Member</h2>
                <p className="text-xs text-gray-400 mt-0.5">Create login credentials for a new team member</p>
              </div>
              <button onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Credentials shown after success */}
            {creds ? (
              <div className="p-6">
                <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <Check size={16} className="text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-green-800">Account Created!</div>
                      <div className="text-xs text-green-600">Share these credentials with the staff member</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-white rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Phone (Login)</div>
                        <div className="text-sm font-semibold text-gray-900">{creds.phone}</div>
                      </div>
                      <button onClick={() => copyText(creds.phone, 'Phone')}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <Copy size={14} />
                      </button>
                    </div>

                    <div className="bg-white rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Initial PIN</div>
                        <div className="text-2xl font-black tracking-[0.3em] text-blue-700">{creds.initial_pin}</div>
                      </div>
                      <button onClick={() => copyText(creds.initial_pin, 'PIN')}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 p-2 bg-amber-50 border border-amber-200 rounded-xl">
                    <Shield size={13} className="text-amber-600 flex-shrink-0" />
                    <p className="text-[11px] text-amber-700 font-medium">They log in with phone number + PIN. Must change PIN on first login.</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { setCreds(null) }}
                    className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition">
                    Add Another Staff
                  </button>
                  <button onClick={() => { setShowModal(false); setCreds(null) }}
                    className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      Full Name *
                    </label>
                    <div className="relative">
                      <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
                        placeholder="e.g. Ama Owusu" type="text"
                        className="w-full h-11 pl-9 pr-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-50 transition" />
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      Email <span className="text-[10px] text-gray-400 normal-case font-normal">(optional — for sending documents)</span>
                    </label>
                    <div className="relative">
                      <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={form.email} onChange={e => set('email', e.target.value)}
                        placeholder="ama@cambridge.edu.gh" type="email"
                        className="w-full h-11 pl-9 pr-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-50 transition" />
                    </div>
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      Phone Number * <span className="text-[10px] text-gray-400 normal-case font-normal">(used for WhatsApp notifications in their name)</span>
                    </label>
                    <div className="relative">
                      <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={form.phone} onChange={e => set('phone', e.target.value)}
                        placeholder="0241234567" type="tel"
                        className="w-full h-11 pl-9 pr-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-50 transition" />
                    </div>
                  </div>

                  {/* Department + PIN row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Department</label>
                      <div className="relative">
                        <Briefcase size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input value={form.department} onChange={e => set('department', e.target.value)}
                          placeholder="Marketing" type="text"
                          className="w-full h-11 pl-9 pr-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 transition" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                        Initial PIN <span className="text-[10px] text-gray-400 normal-case font-normal">(blank = last 4 of phone)</span>
                      </label>
                      <div className="relative">
                        <Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input value={form.initial_pin} onChange={e => set('initial_pin', e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="1234" type={showPin ? 'text' : 'password'}
                          className="w-full h-11 pl-9 pr-10 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 transition" />
                        <button type="button" onClick={() => setShowPin(!showPin)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Role *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {ROLES.filter(r => r.value !== 'super_admin').map(r => (
                        <button key={r.value} type="button" onClick={() => set('role', r.value)}
                          className={`h-10 px-3 rounded-xl text-[12px] font-semibold border-2 transition text-left ${
                            form.role === r.value
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}>
                          {r.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => set('role', 'super_admin')}
                        className={`h-10 px-3 rounded-xl text-[12px] font-semibold border-2 transition text-left col-span-2 ${
                          form.role === 'super_admin'
                            ? 'border-purple-600 bg-purple-50 text-purple-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>
                        🔐 Super Admin (full access)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-6">
                  <button onClick={createStaff} disabled={saving}
                    className="flex-1 h-11 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
                    {saving
                      ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating...</>
                      : <><Check size={16} /> Create Account</>}
                  </button>
                  <button onClick={() => setShowModal(false)}
                    className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-gray-400 text-sm">{staff.length} team members across all roles</p>
        </div>
        <button onClick={openModal}
          className="flex items-center gap-2 h-10 px-5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition">
          <Plus size={16} /> Add Staff
        </button>
      </div>

      {/* ── Role summary pills ── */}
      <div className="flex flex-wrap gap-2 mb-5">
        {byRole.filter(r => r.count > 0).map(r => (
          <div key={r.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${r.color}`}>
            {r.label} <span className="font-black">{r.count}</span>
          </div>
        ))}
      </div>

      {/* ── Search + table ── */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        {/* Search bar */}
        <div className="px-4 py-3 border-b border-gray-100">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or phone..."
            className="w-full h-9 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-500 bg-gray-50 focus:bg-white transition" />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-300">
            <User size={36} className="mx-auto mb-3 opacity-50" />
            <p className="font-medium text-sm">{search ? 'No staff match your search' : 'No staff yet — add your first team member'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Staff Member', 'Contact', 'Role', 'Dept', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${ROLE_COLOR[s.role]?.replace('text-', 'bg-').replace('-100', '-600').replace('-700','') || 'bg-gray-500'}`}>
                          {s.full_name?.charAt(0) || '?'}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-gray-900">{s.full_name}</div>
                          <div className="text-[11px] text-gray-400">{s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-600">{s.phone?.replace(/^233/, '0') || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${ROLE_COLOR[s.role] || 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABEL[s.role] || s.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{(s as any).department || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {s.is_active ? '● Active' : '○ Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <a href={`/admin/staff/${s.id}`}
                          className="text-xs font-semibold px-3 py-1.5 rounded-xl text-blue-600 bg-blue-50 hover:bg-blue-100 transition">
                          Manage Access
                        </a>
                        <button onClick={() => toggleActive(s.id, s.is_active)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition ${
                            s.is_active
                              ? 'text-red-600 bg-red-50 hover:bg-red-100'
                              : 'text-green-600 bg-green-50 hover:bg-green-100'
                          }`}>
                          {s.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
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
