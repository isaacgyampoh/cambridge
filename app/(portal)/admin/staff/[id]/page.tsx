'use client'
import { useState, useEffect, use, useCallback } from 'react'
import { PIN_LENGTH } from '@/lib/auth/pinPolicy'
import { displayPhone } from '@/lib/ui/contact'
import { useRouter } from 'next/navigation'
import { portalGroups } from '@/lib/nav/model'
import { ROLE_DEFAULTS, resolvePortals } from '@/lib/access/portals'
import { NAV_ICONS } from '@/components/shared/navIcons'
import { toast } from 'sonner'
import Link from 'next/link'

/*
 * What each permission actually lets somebody do.
 *
 * Written for the person granting it, in the terms they would use — an
 * administrator deciding whether a trainer should have "Clock in" needs to
 * know it is staff attendance, not a student register. Every grantable
 * portal has an entry, and tests/staffPermissions asserts it, because a
 * toggle with a blank line under it tells the grantee nothing about what
 * they are handing over.
 */
const PORTAL_DESC: Record<string, string> = {
  insights: 'Charts and trends across the centre',
  reports: 'Read-only performance reports',
  messages: 'Internal staff messaging',
  remuneration: 'Commission rates and marketer pay',
  my_earnings: 'Their own commission and earnings',
  my_link: 'Their personal referral link',
  my_flyers: 'Their own campaign flyers',
  my_links: 'Shared marketing links',
  registrations: 'Registration fees and marketer payouts',
  my_attendance: 'Attendance for classes they market',
  prep: 'Exam prep tracker and content bank',
  wa_lines: 'WhatsApp numbers and connection status',
  knowledge: 'What the AI assistant is taught',
  conversations: 'AI conversations with leads',
  grp_automation: 'Scheduled reminders and info sessions',
  workforce: 'Staff attendance and office locations',
  clock_in: 'Clocking themselves in and out',
  grp_socials: 'Social media content and drafts',
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

  /*
   * useCallback so the effect's dependency is real rather than silenced.
   *
   * The effect listed the value the loader reads but not the loader itself,
   * so the relationship was correct by coincidence: it held only because the
   * function is redefined every render. A future edit that captured anything
   * else would go stale with nothing to say so.
   */
  const reload = useCallback(() => {
    return fetch(`/api/data?table=profiles&select=*&filters=${encodeURIComponent(JSON.stringify([{col:'id',op:'eq',val:id}]))}`)
      .then(r => r.json())
      .then(d => {
        const s = d.data?.[0]
        if (!s) return
        setStaff(s)
        /*
         * resolvePortals — the SAME function the route guard and the sidebar
         * use — rather than a lookup against a local table.
         *
         * This page carried its own copy of ROLE_DEFAULTS, and every role in
         * it had drifted: a marketing officer was listed as
         * ['dashboard','my_leads','leads'] when the real defaults are nine
         * portals, and exam_coordinator, content_manager and administrator
         * were absent altogether, falling through to ['dashboard'].
         *
         * That was not a display bug. Saving writes `portals` explicitly, and
         * resolvePortals treats a non-empty saved list as the WHOLE of a
         * person's access — it is not merged with role defaults, or nothing
         * could ever be taken away. So opening a marketer who had never been
         * customised and pressing Save silently stripped their earnings,
         * link, flyers, reports, class attendance, clock-in and messages, and
         * handed them the full admin lead board they should not have. For a
         * content manager or exam coordinator it reduced them to the
         * dashboard and nothing else.
         */
        setSelected(new Set(resolvePortals(s.role, s.portals)))
        setLoading(false)
      })
  }, [id])
  useEffect(() => { reload() }, [reload])

  function toggle(portalId: string) {
    if (portalId === 'dashboard') return // always on
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(portalId)) next.delete(portalId)
      else next.add(portalId)
      return next
    })
  }

  function resetToDefaults() {
    // The real defaults for the role, from the one place that defines them.
    setSelected(new Set(ROLE_DEFAULTS[staff?.role] || ['dashboard']))
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

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"/></div>
  if (!staff) return <div className="text-center py-20 text-[var(--ink-faint)]">Staff member not found</div>

  const ROLE_COLOR: Record<string, string> = {
    super_admin:'bg-[var(--gold-soft)] text-[var(--gold)]', project_manager:'bg-[var(--accent-soft)] text-[var(--accent)]',
    marketing_officer:'bg-[var(--ok-soft)] text-[var(--ok)]', admissions_officer:'bg-[var(--info-soft)] text-[var(--info)]',
    accountant:'bg-[var(--warn-soft)] text-[var(--warn)]', receptionist:'bg-[var(--danger-soft)] text-[var(--danger)]',
    trainer:'bg-[var(--warn-soft)] text-[var(--warn)]',
  }

  // Group portals
  /*
   * Every grantable portal, grouped from the navigation catalogue.
   *
   * The list here named seventeen. There are thirty-three, so sixteen —
   * my_earnings, my_link, my_flyers, reports, my_attendance, clock_in,
   * messages, registrations, insights, conversations, remuneration,
   * knowledge, wa_lines, workforce, my_links and prep — had no checkbox on
   * the one screen that exists to grant and revoke them. Several are role
   * defaults, so they could be lost by saving and never given back.
   */
  const groups = portalGroups()

  return (
    <div className="w-full max-w-3xl mx-auto fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/staff" className="flex items-center gap-1.5 h-9 px-3 bg-[var(--paper)] border border-[var(--line)] text-[var(--ink-soft)] rounded-xl text-sm font-medium hover:bg-[var(--line-soft)] transition">
           Staff
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Portal Access — {staff.full_name}</h1>
          <p className="text-[var(--ink-faint)] text-sm">Choose which portals this person can access</p>
        </div>
      </div>

      {/* Staff card */}
      <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-4 mb-5 flex items-center gap-4 shadow-[var(--shadow-raised)]">
        <div className="w-12 h-12 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
          {staff.full_name?.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[var(--ink)]">{staff.full_name}</div>
          <div className="text-sm text-[var(--ink-faint)]">{displayPhone(staff.phone)}</div>
          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${ROLE_COLOR[staff.role]||'bg-[var(--line-soft)] text-[var(--ink-soft)]'}`}>
            {staff.role?.replace(/_/g,' ')}
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[var(--accent)]">{selected.size}</div>
          <div className="text-xs text-[var(--ink-faint)]">portals selected</div>
        </div>
      </div>

      {/* Edit details / reset PIN (super admin) */}
      <EditStaffPanel staff={staff} onSaved={reload} />

      {/* Info banner */}
      <div className="bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-2xl p-4 mb-5 flex gap-3">
        
        <div className="text-sm text-[var(--accent)]">
          <strong>Note:</strong> You can give any staff member access to any portal, regardless of their role.
          For example, a finance officer can also be given the Leads portal to input and manage leads.
          The <strong>Dashboard</strong> is always included.
        </div>
      </div>

      {/* Portal groups */}
      <div className="space-y-4 mb-5">
        {groups.map(group => {
          const portalsInGroup = group.portals
          return (
            <div key={group.label} className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] overflow-hidden shadow-[var(--shadow-raised)]">
              <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--line-soft)]">
                <span className="text-xs font-bold text-[var(--ink-faint)]">{group.label}</span>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {portalsInGroup.map(portal => {
                  const Icon    = NAV_ICONS[portal.icon as keyof typeof NAV_ICONS]
                  const on      = selected.has(portal.id)
                  const locked  = portal.id === 'dashboard'
                  return (
                    <button key={portal.id} onClick={() => toggle(portal.id)} disabled={locked}
                      className={`flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-all
                        ${on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--paper)] hover:border-[var(--line)]'}
                        ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                      {/*
                        The portal's own icon. It was looked up into `Icon` and
                        then never rendered — the row's gap-3 had nothing to
                        space, so every permission in the list read as an
                        unlabelled block of text.
                      */}
                      {Icon && (
                        <span aria-hidden="true"
                          className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0
                            ${on ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--line-soft)] text-[var(--ink-faint)]'}`}>
                          <Icon size={16} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-bold truncate ${on ? 'text-[var(--accent)]' : 'text-[var(--ink-soft)]'}`}>{portal.label}</div>
                        <div className="text-[12px] text-[var(--ink-faint)] truncate">{PORTAL_DESC[portal.id] || ''}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${on ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line)]'}`}>
                        {on && <div className="w-2 h-2 bg-[var(--paper)] rounded-full"/>}
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
           {saving ? 'Saving…' : 'Save Permissions'}
        </button>
        <button onClick={resetToDefaults}
          className="h-12 px-5 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition">
          Reset to defaults
        </button>
        <Link href="/admin/staff" className="h-12 px-5 bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition flex items-center">
          Cancel
        </Link>
      </div>
    </div>
  )
}

function EditStaffPanel({ staff, onSaved }: { staff: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  /*
   * Seeded once, from the row this panel was mounted with.
   *
   * It used to be seeded in an effect keyed on `staff`, which meant every
   * refetch of the staff row overwrote whatever the administrator had typed.
   * `onSaved` is that refetch, so today it only fires after a save and the
   * overwrite is invisible — but it is a wipe waiting for a second caller,
   * and on the panel that sets someone's login PIN, losing half-entered
   * changes is not a small thing.
   *
   * The panel renders below the `if (!staff) return` guard, so the row is
   * always present by the time this runs and there is nothing to wait for.
   */
  const [form, setForm] = useState(() => ({
    full_name: staff.full_name || '',
    phone: displayPhone(staff.phone),
    email: staff.email || '',
    new_pin: '',
  }))

  async function save() {
    setSaving(true)
    const d = await fetch('/api/admin/edit-staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: staff.id, ...form }),
    }).then(r => r.json()).catch(() => ({ error: 'Request failed' }))
    setSaving(false)
    if (d.success) {
      const { toast } = await import('sonner')
      toast.success(d.pinReset ? 'Saved. New PIN set — they\'ll be asked to change it on next login.' : 'Staff details updated.')
      setForm(f => ({ ...f, new_pin: '' }))
      onSaved()
    } else {
      const { toast } = await import('sonner')
      toast.error(d.error || 'Could not save')
    }
  }

  return (
    <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] mb-5 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--canvas)] transition">
        <div className="text-left">
          <div className="text-[15px] font-semibold text-[var(--ink)]">Edit details &amp; reset PIN</div>
          <div className="text-[13px] text-[var(--ink-soft)]">Change their phone, email, name, or set a new login PIN if they’re locked out.</div>
        </div>
        <span className="text-[var(--ink-faint)] text-lg">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-3 border-t border-[var(--line-soft)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">Full name</label>
              <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                className="w-full h-11 px-4 rounded-2xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="024 000 0000"
                className="w-full h-11 px-4 rounded-2xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">Email</label>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@email.com"
                className="w-full h-11 px-4 rounded-2xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">Set new PIN (optional)</label>
              <input value={form.new_pin} onChange={e => setForm(f => ({ ...f, new_pin: e.target.value.replace(/[^0-9]/g, '') }))} placeholder={`${PIN_LENGTH} digits`} maxLength={PIN_LENGTH} inputMode="numeric"
                className="w-full h-11 px-4 rounded-2xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
            </div>
          </div>
          <p className="text-[12px] text-[var(--ink-faint)]">Leave the PIN blank to keep it unchanged. Setting a new one lets a locked-out staff log in; they’ll be asked to choose their own on first login.</p>
          <button onClick={save} disabled={saving}
            className="h-11 px-5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}
