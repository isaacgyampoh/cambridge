'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { ALL_PORTALS } from '@/components/shared/PortalLayout'
import { toast } from 'sonner'
import { ArrowLeft, Save, Shield } from 'lucide-react'
import Link from 'next/link'

const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin:       ['dashboard','leads','admissions','finance','broadcast','attendance','academics','documents','marketers','alumni','staff','settings'],
  project_manager:   ['dashboard','pm_leads','leads','admissions'],
  marketing_officer: ['dashboard','my_leads','leads'],
  admissions_officer:['dashboard','admissions','leads'],
  accountant:        ['dashboard','finance','leads'],
  receptionist:      ['dashboard','reminders','attendance'],
  trainer:           ['dashboard','my_classes','attendance'],
  student:           ['dashboard','my_payments'],
}

const PORTAL_DESC: Record<string, string> = {
  dashboard: 'Main dashboard overview',
  leads: 'All leads, pipeline, add/import leads',
  my_leads: 'Own assigned leads and follow-ups',
  pm_leads: 'Lead inbox and assignment (PM view)',
  admissions: 'Admission cases and applications',
  finance: 'Payments, invoices, financial reports',
  broadcast: 'Bulk WhatsApp & SMS campaigns',
  attendance: 'Class sign-ins and sessions',
  academics: 'Courses and class batches',
  documents: 'PDF templates and documents',
  marketers: 'Marketer performance monitor',
  alumni: 'Alumni and success stories',
  staff: 'Staff management and reports',
  my_classes: 'Trainer class management',
  my_payments: 'Student payment view',
  reminders: 'Class reminders system',
  settings: 'System settings',
}

export default function StaffPermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router  = useRouter()
  const [staff,    setStaff]    = useState<any>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    fetch(`/api/data?table=profiles&select=*&filters=${encodeURIComponent(JSON.stringify([{col:'id',op:'eq',val:id}]))}`)
      .then(r => r.json())
      .then(d => {
        const s = d.data?.[0]
        if (!s) return
        setStaff(s)
        const portals = s.portals?.length ? s.portals : ROLE_DEFAULTS[s.role] || ['dashboard']
        setSelected(new Set(portals))
        setLoading(false)
      })
  }, [id])

  function toggle(portalId: string) {
    if (portalId === 'dashboard') return // always on
    setSelected(prev => {
      const next = new Set(prev)
      next.has(portalId) ? next.delete(portalId) : next.add(portalId)
      return next
    })
  }

  function resetToDefaults() {
    const defaults = ROLE_DEFAULTS[staff?.role] || ['dashboard']
    setSelected(new Set(defaults))
    toast.info('Reset to role defaults')
  }

  async function save() {
    setSaving(true)
    await fetch('/api/data', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'profiles',
        data: { portals: Array.from(selected) },
        filters: [{ col: 'id', val: id }],
      }),
    })
    toast.success(`Permissions updated for ${staff?.full_name}!`)
    setSaving(false)
    router.push('/admin/staff')
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"/></div>
  if (!staff) return <div className="text-center py-20 text-[var(--ink-faint)]">Staff member not found</div>

  const ROLE_COLOR: Record<string, string> = {
    super_admin:'bg-[var(--gold-soft)] text-[var(--gold)]', project_manager:'bg-[var(--accent-soft)] text-[var(--accent)]',
    marketing_officer:'bg-[var(--ok-soft)] text-[var(--ok)]', admissions_officer:'bg-[var(--info-soft)] text-[var(--info)]',
    accountant:'bg-[var(--warn-soft)] text-[var(--warn)]', receptionist:'bg-[var(--danger-soft)] text-[var(--danger)]',
    trainer:'bg-[var(--warn-soft)] text-[var(--warn)]',
  }

  // Group portals
  const groups = [
    { label: 'Core', ids: ['dashboard'] },
    { label: 'CRM & Leads', ids: ['leads','my_leads','pm_leads'] },
    { label: 'Admissions', ids: ['admissions'] },
    { label: 'Finance', ids: ['finance','my_payments'] },
    { label: 'Communication', ids: ['broadcast'] },
    { label: 'Classes & Training', ids: ['attendance','academics','my_classes','reminders'] },
    { label: 'Content', ids: ['documents','alumni'] },
    { label: 'Management', ids: ['marketers','staff','settings'] },
  ]

  return (
    <div className="w-full max-w-3xl mx-auto fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/staff" className="flex items-center gap-1.5 h-9 px-3 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-xl text-sm font-medium hover:bg-[var(--line-soft)] transition">
          <ArrowLeft size={15}/> Staff
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Portal Access — {staff.full_name}</h1>
          <p className="text-[var(--ink-faint)] text-sm">Choose which portals this person can access</p>
        </div>
      </div>

      {/* Staff card */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-4 mb-5 flex items-center gap-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-lg font-black flex-shrink-0">
          {staff.full_name?.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[var(--ink)]">{staff.full_name}</div>
          <div className="text-sm text-[var(--ink-faint)]">{staff.phone?.replace(/^233/,'0')}</div>
          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${ROLE_COLOR[staff.role]||'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
            {staff.role?.replace(/_/g,' ')}
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-[var(--accent)]">{selected.size}</div>
          <div className="text-xs text-[var(--ink-faint)]">portals selected</div>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-[var(--accent-soft)] border border-blue-100 rounded-2xl p-4 mb-5 flex gap-3">
        <Shield size={18} className="text-[var(--accent)] flex-shrink-0 mt-0.5"/>
        <div className="text-sm text-[var(--accent)]">
          <strong>Note:</strong> You can give any staff member access to any portal, regardless of their role.
          For example, a finance officer can also be given the Leads portal to input and manage leads.
          The <strong>Dashboard</strong> is always included.
        </div>
      </div>

      {/* Portal groups */}
      <div className="space-y-4 mb-5">
        {groups.map(group => {
          const portalsInGroup = group.ids.map(id => ALL_PORTALS.find(p => p.id === id)).filter(Boolean)
          return (
            <div key={group.label} className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--line-soft)]">
                <span className="text-xs font-bold text-[var(--ink-faint)] uppercase tracking-wide">{group.label}</span>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {portalsInGroup.map((portal: any) => {
                  const Icon    = portal.icon
                  const on      = selected.has(portal.id)
                  const locked  = portal.id === 'dashboard'
                  return (
                    <button key={portal.id} onClick={() => toggle(portal.id)} disabled={locked}
                      className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all
                        ${on ? 'border-blue-500 bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-white hover:border-gray-300'}
                        ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${on ? 'bg-[var(--accent)]' : 'bg-[var(--line-soft)]'}`}>
                        <Icon size={17} className={on ? 'text-white' : 'text-[var(--ink-faint)]'} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-bold truncate ${on ? 'text-[var(--accent)]' : 'text-[var(--ink-soft)]'}`}>{portal.label}</div>
                        <div className="text-[12px] text-[var(--ink-faint)] truncate">{PORTAL_DESC[portal.id] || ''}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${on ? 'border-blue-600 bg-[var(--accent)]' : 'border-gray-300'}`}>
                        {on && <div className="w-2 h-2 bg-white rounded-full"/>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={save} disabled={saving}
          className="flex-1 h-12 bg-[var(--accent)] text-white rounded-xl text-sm font-bold hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2">
          <Save size={16}/> {saving ? 'Saving…' : 'Save Permissions'}
        </button>
        <button onClick={resetToDefaults}
          className="h-12 px-5 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition">
          Reset to Defaults
        </button>
        <Link href="/admin/staff" className="h-12 px-5 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition flex items-center">
          Cancel
        </Link>
      </div>
    </div>
  )
}
