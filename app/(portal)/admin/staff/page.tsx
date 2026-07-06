'use client'
import { useState } from 'react'
import { useData } from '@/hooks/useData'
import Modal from '@/components/shared/Modal'
import { toast } from 'sonner'
import { Plus, X, Check, Copy, Eye, EyeOff, Shield, Phone, Mail, User, Briefcase, Hash } from 'lucide-react'

const ROLES = [
  { value: 'project_manager', label: 'Project Manager', color: 'bg-[var(--accent-soft)] text-[var(--accent)]'},
  { value: 'marketing_officer', label: 'Marketing Officer', color: 'bg-[var(--ok-soft)] text-[var(--ok)]'},
  { value: 'content_manager', label: 'Content Manager', color: 'bg-[var(--gold-soft)] text-[var(--gold)]'},
  { value: 'admissions_officer',label: 'Admissions Officer', color: 'bg-[var(--info-soft)] text-[var(--info)]'},
  { value: 'accountant', label: 'Accountant', color: 'bg-[var(--warn-soft)] text-[var(--warn)]'},
  { value: 'receptionist', label: 'Receptionist', color: 'bg-[var(--line-soft)] text-[var(--ink-soft)]'},
  { value: 'trainer', label: 'Trainer', color: 'bg-[var(--gold-soft)] text-[var(--gold)]'},
  { value: 'exam_coordinator', label: 'Exam Prep Coordinator', color: 'bg-[var(--ok-soft)] text-[var(--ok)]'},
  { value: 'super_admin', label: 'Super Admin', color: 'bg-[var(--ink)] text-white'},
]

const ROLE_COLOR: Record<string, string> = Object.fromEntries(ROLES.map(r => [r.value, r.color]))
const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES.map(r => [r.value, r.label]))

const EMPTY = { full_name: '', email: '', phone: '', role: 'marketing_officer', initial_pin: '', department: '', coordinator_program: '', performance_tier: 'mid', also_markets: false }

export default function StaffPage() {
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [creds, setCreds] = useState<any>(null)
  const [showPin, setShowPin] = useState(false)
  const [search, setSearch] = useState('')

  const { data: staff, loading, refetch } = useData({
    table: 'profiles',
    select: '*',
    orderBy: 'full_name', orderAsc: true,
    filters: [{ col: 'role', op: 'neq', val: 'student'}],
  })

  function set(k: string, v: string | boolean) { setForm(f => ({ ...f, [k]: v })) }

  function openModal() { setForm({ ...EMPTY }); setCreds(null); setShowModal(true) }

  async function createStaff() {
    if (!form.full_name.trim() || !form.phone.trim()) {
      toast.error('Full name and phone number are required')
      return
    }
    if (!form.email.trim()) {
      toast.error('Email is required — staff receive their login code by email')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Please enter a valid email address')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/create-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'Failed to create staff')
      toast.success(` ${form.full_name} created!`)
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
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify({ table: 'profiles', data: { is_active: !current }, filters: [{ col: 'id', val: id }] }),
    })
    toast.success(current ? 'Deactivated': 'Activated')
    refetch()
  }

  async function toggleLeadPool(id: string, current: boolean) {
    await fetch('/api/data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify({ table: 'profiles', data: { in_lead_pool: !current }, filters: [{ col: 'id', val: id }] }),
    })
    toast.success(current ? 'Removed from lead pool': 'Added to lead pool')
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
      <Modal open={showModal} onClose={() => setShowModal(false)} maxWidth="max-w-lg">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line-soft)]">
              <div>
                <h2 className="font-semibold text-[var(--ink)]">Add Staff Member</h2>
                <p className="text-xs text-[var(--ink-faint)] mt-0.5">Create login credentials for a new team member</p>
              </div>
              <button onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center text-[var(--ink-faint)] hover:text-[var(--ink-soft)] hover:bg-[var(--line-soft)] rounded-xl transition-colors">
                
              </button>
            </div>

            {/* Credentials shown after success */}
            {creds ? (
              <div className="p-6">
                <div className="bg-[var(--ok-soft)] border border-[var(--ok)]/20 rounded-2xl p-5 mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-[var(--ok)]/10 rounded-full flex items-center justify-center">
                      
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[var(--ok)]">Account Created!</div>
                      <div className="text-xs text-[var(--ok)]">Share these credentials with the staff member</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-white rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold text-[var(--ink-faint)]">Phone (Login)</div>
                        <div className="text-sm font-semibold text-[var(--ink)]">{creds.phone}</div>
                      </div>
                      <button onClick={() => copyText(creds.phone, 'Phone')}
                        className="p-2 text-[var(--ink-faint)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-lg transition-colors">
                        
                      </button>
                    </div>

                    <div className="bg-white rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold text-[var(--ink-faint)]">Initial PIN</div>
                        <div className="text-2xl font-bold tracking-[0.3em] text-[var(--accent)]">{creds.initial_pin}</div>
                      </div>
                      <button onClick={() => copyText(creds.initial_pin, 'PIN')}
                        className="p-2 text-[var(--ink-faint)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] rounded-lg transition-colors">
                        
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 p-2 bg-[var(--warn-soft)] border border-[var(--warn)]/20 rounded-xl">
                    
                    <p className="text-[12px] text-[var(--warn)] font-medium">They log in with phone number + PIN. Must change PIN on first login.</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { setCreds(null) }}
                    className="flex-1 h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-bold hover:brightness-110 transition">
                    Add Another Staff
                  </button>
                  <button onClick={() => { setShowModal(false); setCreds(null) }}
                    className="flex-1 h-11 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--ink-faint)] mb-1.5">
                      Full Name *
                    </label>
                    <div className="relative">
                      
                      <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
                        placeholder="e.g. Ama Owusu"type="text"
                        className="w-full h-11 pl-9 pr-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition" />
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--ink-faint)] mb-1.5">
                      Email <span className="text-[10px] text-[var(--danger)] normal-case font-normal">(required — for login codes &amp; documents)</span>
                    </label>
                    <div className="relative">
                      
                      <input value={form.email} onChange={e => set('email', e.target.value)}
                        placeholder="ama@cambridge.edu.gh"type="email"
                        className="w-full h-11 pl-9 pr-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition" />
                    </div>
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--ink-faint)] mb-1.5">
                      Phone Number * <span className="text-[10px] text-[var(--ink-faint)] normal-case font-normal">(used for WhatsApp notifications in their name)</span>
                    </label>
                    <div className="relative">
                      
                      <input value={form.phone} onChange={e => set('phone', e.target.value)}
                        placeholder="0241234567"type="tel"
                        className="w-full h-11 pl-9 pr-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition" />
                    </div>
                  </div>

                  {/* Department + PIN row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[var(--ink-faint)] mb-1.5">Department</label>
                      <div className="relative">
                        
                        <input value={form.department} onChange={e => set('department', e.target.value)}
                          placeholder="Marketing"type="text"
                          className="w-full h-11 pl-9 pr-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[var(--ink-faint)] mb-1.5">
                        Initial PIN <span className="text-[10px] text-[var(--ink-faint)] normal-case font-normal">(blank = last 4 of phone)</span>
                      </label>
                      <div className="relative">
                        
                        <input value={form.initial_pin} onChange={e => set('initial_pin', e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="1234" type={showPin ? 'text': 'password'}
                          className="w-full h-11 pl-9 pr-10 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
                        <button type="button" onClick={() => setShowPin(!showPin)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] hover:text-[var(--ink-soft)]">
                          {showPin ? null : null}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-xs font-bold text-[var(--ink-faint)] mb-2">Role *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {ROLES.filter(r => r.value !== 'super_admin').map(r => (
                        <button key={r.value} type="button" onClick={() => set('role', r.value)}
                          className={`h-10 px-3 rounded-xl text-[12px] font-semibold border-2 transition text-left ${
                            form.role === r.value
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--line)] hover:bg-[var(--line-soft)]'
                          }`}>
                          {r.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => set('role', 'super_admin')}
                        className={`h-10 px-3 rounded-xl text-[12px] font-semibold border-2 transition text-left col-span-2 ${
                          form.role === 'super_admin'
                            ? 'border-purple-600 bg-purple-50 text-[var(--gold)]'
                            : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--line)]'
                        }`}>
                         Super Admin (full access)
                      </button>
                    </div>
                  </div>

                  {form.role === 'exam_coordinator' && (
                    <div>
                      <label className="block text-xs font-bold text-[var(--ink-faint)] mb-2">Programme they coordinate *</label>
                      <input value={form.coordinator_program} onChange={e => set('coordinator_program', e.target.value.toUpperCase())}
                        placeholder="e.g. PMP or SPHRI (the course code)"
                        className="w-full h-11 px-4 rounded-xl border-2 border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
                      <p className="text-[12px] text-[var(--ink-faint)] mt-1.5">Must match the course code. All students of this programme are auto-assigned to this coordinator.</p>
                    </div>
                  )}

                  {/* Also markets — for staff who aren't primarily marketers but
                      also convert leads (e.g. a PM or accountant who markets) */}
                  {form.role !== 'marketing_officer' && form.role !== 'super_admin' && (
                    <label className="flex items-start gap-3 p-4 rounded-xl border border-[var(--line)] cursor-pointer hover:bg-[var(--canvas)] transition">
                      <input type="checkbox" checked={form.also_markets} onChange={e => set('also_markets', e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[var(--accent)]" />
                      <div>
                        <div className="text-[14px] font-medium text-[var(--ink)]">This person also markets</div>
                        <div className="text-[13px] text-[var(--ink-soft)]">They'll get their own marketer link and receive leads to convert, on top of their main role.</div>
                      </div>
                    </label>
                  )}

                  {/* Performance tier — shown for anyone who receives leads */}
                  {(form.role === 'marketing_officer' || form.also_markets) && (
                    <div>
                      <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-2">Performance tier</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { v: 'high', l: 'High performer', d: 'Gets the most leads' },
                          { v: 'mid', l: 'Mid performer', d: 'Standard share' },
                          { v: 'low', l: 'Low performer', d: 'Fewer leads' },
                          { v: 'support', l: 'Support', d: 'Smallest share' },
                        ].map(t => (
                          <button key={t.v} type="button" onClick={() => set('performance_tier', t.v)}
                            className={`text-left px-3 py-2.5 rounded-xl border-2 transition ${
                              form.performance_tier === t.v
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                : 'border-[var(--line)] hover:border-[var(--ink-faint)]'
                            }`}>
                            <div className={`text-[13px] font-semibold ${form.performance_tier === t.v ? 'text-[var(--accent)]' : 'text-[var(--ink)]'}`}>{t.l}</div>
                            <div className="text-[11px] text-[var(--ink-faint)]">{t.d}</div>
                          </button>
                        ))}
                      </div>
                      <p className="text-[12px] text-[var(--ink-faint)] mt-2">Higher tiers receive a larger share of incoming leads. This adjusts automatically over time based on conversions.</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-6">
                  <button onClick={createStaff} disabled={saving}
                    className="flex-1 h-11 bg-[var(--accent)] text-white rounded-xl text-sm font-bold hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2">
                    {saving
                      ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating...</>
                      : <> Create Account</>}
                  </button>
                  <button onClick={() => setShowModal(false)}
                    className="flex-1 h-11 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition">
                    Cancel
                  </button>
                </div>
              </div>
            )}
      </Modal>

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-[13px] font-medium text-[var(--ink-faint)] mb-2">People</div>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">Staff</h1>
          <p className="text-[var(--ink-soft)] text-sm mt-1.5">{staff.length} team members across all roles</p>
        </div>
        <button onClick={openModal}
          className="inline-flex items-center gap-2 h-10 px-4 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:brightness-110 transition shadow-sm">
           Add staff
        </button>
      </div>

      {/* ── Role summary pills ── */}
      <div className="flex flex-wrap gap-2 mb-5">
        {byRole.filter(r => r.count > 0).map(r => (
          <div key={r.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${r.color}`}>
            {r.label} <span className="font-bold">{r.count}</span>
          </div>
        ))}
      </div>

      {/* ── Search + table ── */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line)] overflow-hidden">
        {/* Search bar */}
        <div className="px-4 py-3 border-b border-[var(--line)]">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or phone"
            className="w-full h-9 px-4 rounded-lg border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] bg-[var(--line-soft)] focus:bg-white transition" />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--ink-faint)]">
            
            <p className="font-medium text-sm">{search ? 'No staff match your search': 'No staff yet — add your first team member'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--line-soft)]">
                <tr>
                  {['Staff Member', 'Contact', 'Role', 'Dept', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-t border-[var(--line-soft)] hover:bg-[var(--line-soft)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${ROLE_COLOR[s.role]?.replace('text-', 'bg-').replace('-100', '-600').replace('-700','') || 'bg-[var(--canvas)]0'}`}>
                          {s.full_name?.charAt(0) || '?'}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[var(--ink)]">{s.full_name}</div>
                          <div className="text-[12px] text-[var(--ink-faint)]">{s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-[var(--ink-soft)]">{s.phone?.replace(/^233/, '0') || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${ROLE_COLOR[s.role] || 'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
                        {ROLE_LABEL[s.role] || s.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--ink-faint)]">{(s as any).department || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${s.is_active ? 'bg-[var(--ok-soft)] text-[var(--ok)]': 'bg-[var(--danger-soft)] text-[var(--danger)]'}`}>
                        {s.is_active ? '● Active': '○ Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <a href={`/admin/staff/${s.id}`}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg text-[var(--accent)] bg-[var(--accent-soft)] hover:brightness-95 transition">
                          Manage Access
                        </a>
                        <button onClick={() => toggleActive(s.id, s.is_active)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition ${
                            s.is_active
                              ? 'text-[var(--danger)] bg-[var(--danger-soft)] hover:brightness-95'
                              : 'text-[var(--ok)] bg-[var(--ok-soft)] hover:brightness-95'
                          }`}>
                          {s.is_active ? 'Deactivate': 'Activate'}
                        </button>
                        {s.role !== 'super_admin' && (
                          <button onClick={() => toggleLeadPool(s.id, s.in_lead_pool !== false)}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-xl transition ${
                              s.in_lead_pool !== false
                                ? 'text-[var(--accent)] bg-[var(--accent-soft)] hover:brightness-95'
                                : 'text-[var(--ink-faint)] bg-[var(--line-soft)] hover:brightness-95'
                            }`}>
                            {s.in_lead_pool !== false ? 'In lead pool' : 'Not in pool'}
                          </button>
                        )}
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
