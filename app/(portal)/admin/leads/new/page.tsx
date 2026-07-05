'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, UserPlus, Phone, Mail, BookOpen, Globe, MessageSquare } from 'lucide-react'
import Link from 'next/link'

const SOURCES = ['manual','facebook','google','linkedin','website','referral']
const FALLBACK_COURSES = ['Projects Management Professional','Corporate Training','Professional in Human Resources','Senior Professional in Human Resources','Software Agile Projects Management','Results-Based Monitoring and Evaluation','Other']

export default function NewLeadPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [marketers, setMarketers] = useState<any[]>([])
  const [courses, setCourses] = useState<string[]>(FALLBACK_COURSES)
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', gender: '',
    country: 'Ghana', city: '',
    source: 'manual', course_interest: '',
    notes: '', assigned_to: '',
  })

  useEffect(() => {
    fetch('/api/data?table=profiles&select=id,full_name&filters=' + encodeURIComponent(JSON.stringify([
      { col: 'role', op: 'eq', val: 'marketing_officer' },
      { col: 'is_active', op: 'eq', val: true },
    ])) + '&orderBy=full_name&orderAsc=true')
      .then(r => r.json()).then(d => setMarketers(d.data || []))
    fetch('/api/courses/public').then(r => r.json()).then(d => {
      if (d.courses?.length) setCourses([...d.courses, 'Other'])
    }).catch(() => {})
  }, [])

  function set(key: string, val: string) { setForm(f => ({ ...f, [key]: val })) }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) { toast.error('Full name is required'); return }
    setSaving(true)
    try {
      // Duplicate detection
      if (form.phone.trim() || form.email.trim()) {
        const dup = await fetch('/api/leads/check-duplicate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: form.phone.trim(), email: form.email.trim() }),
        }).then(r => r.json())
        if (dup.duplicate) {
          const owner = dup.lead?.assignee?.full_name ? ` (with ${dup.lead.assignee.full_name})` : ''
          const proceed = confirm(`A lead named "${dup.lead.full_name}" already exists with this phone/email${owner}. Add anyway?`)
          if (!proceed) { setSaving(false); return }
        }
      }
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'leads',
          data: {
            full_name: form.full_name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim().replace(/^0/, '233') || null,
            gender: form.gender || null,
            country: form.country || 'Ghana',
            city: form.city || null,
            source: form.source,
            status: 'new',
            course_interest: form.course_interest || null,
            notes: form.notes || null,
            assigned_to: form.assigned_to || null,
            assigned_at: form.assigned_to ? new Date().toISOString() : null,
          },
        }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)

      // If assigned, trigger notification
      if (form.assigned_to && d.data?.[0]?.id) {
        await fetch('/api/leads/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: d.data[0].id, marketerId: form.assigned_to }),
        })
      }

      toast.success(`Lead "${form.full_name}" added successfully!`)
      router.push('/admin/leads')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const FIELDS = [
    { key: 'full_name',       label: 'Full Name *',      type: 'text',  placeholder: 'Kwame Mensah',         icon: UserPlus,  half: false },
    { key: 'phone',           label: 'Phone Number',     type: 'tel',   placeholder: '024 000 0000',          icon: Phone,     half: true  },
    { key: 'email',           label: 'Email Address',    type: 'email', placeholder: 'kwame@email.com',       icon: Mail,      half: true  },
    { key: 'city',            label: 'City',             type: 'text',  placeholder: 'Accra',                 icon: Globe,     half: true  },
    { key: 'country',         label: 'Country',          type: 'text',  placeholder: 'Ghana',                 icon: Globe,     half: true  },
  ]

  return (
    <div className="w-full fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/leads"
          className="flex items-center gap-1.5 h-9 px-3 bg-white border border-[var(--line)] text-[var(--ink-soft)] rounded-xl text-sm font-medium hover:bg-[var(--line-soft)] transition">
           Leads
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Add New Lead</h1>
          <p className="text-[var(--ink-faint)] text-sm">Manually enter a lead into the system</p>
        </div>
      </div>

      <form onSubmit={save} className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Left — main fields */}
        <div className="xl:col-span-2 space-y-5">

          {/* Personal info */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--ink-soft)] mb-4">Personal Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FIELDS.map(f => (
                <div key={f.key} className={f.half ? '' : 'sm:col-span-2'}>
                  <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">{f.label}</label>
                  <div className="relative">
                    <f.icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]" />
                    <input
                      type={f.type}
                      value={(form as any)[f.key]}
                      onChange={e => set(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full h-11 pl-9 pr-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition"
                    />
                  </div>
                </div>
              ))}

              {/* Gender */}
              <div>
                <label className="block text-[13px] font-medium text-[var(--ink-faint)] mb-1.5">Gender</label>
                <select value={form.gender} onChange={e => set('gender', e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)] transition">
                  <option value="">Select...</option>
                  <option>Male</option><option>Female</option><option>Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Course interest */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--ink-soft)] mb-4">Course Interest</h2>
            <select value={form.course_interest} onChange={e => set('course_interest', e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition">
              <option value="">Select a course…</option>
              {courses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--ink-soft)] mb-4">Notes</h2>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={4}
              placeholder="Any additional info about this lead..."
              className="w-full px-4 py-3 rounded-xl border border-[var(--line)] text-sm resize-none focus:outline-none focus:border-[var(--accent)] transition" />
          </div>
        </div>

        {/* Right — source & assignment */}
        <div className="space-y-5">

          {/* Source */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--ink-soft)] mb-4">Lead Source</h2>
            <div className="space-y-2">
              {SOURCES.map(s => (
                <button key={s} type="button"
                  onClick={() => set('source', s)}
                  className={`w-full flex items-center gap-3 h-11 px-4 rounded-xl text-sm font-semibold border-2 transition capitalize ${
                    form.source === s
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--line)]'
                  }`}>
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    s==='facebook'?'bg-[var(--accent)]':s==='google'?'bg-[var(--danger)]':s==='linkedin'?'bg-[var(--accent)]':
                    s==='website'?'bg-[var(--gold)]':s==='referral'?'bg-[var(--ok)]':'bg-[var(--ink-faint)]'}`} />
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Assign to marketer */}
          <div className="bg-[var(--paper)] rounded-xl border border-[var(--line-soft)] p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[var(--ink-soft)] mb-4">Assign To (optional)</h2>
            <p className="text-xs text-[var(--ink-faint)] mb-3">If assigned now, marketer gets notified via SMS & WhatsApp</p>
            <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)] transition">
              <option value="">Leave unassigned</option>
              {marketers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>

          {/* Submit */}
          <div className="space-y-2">
            <button type="submit" disabled={saving}
              className="w-full h-12 bg-[var(--accent)] text-white rounded-xl text-sm font-bold hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {saving
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
                : <> Add Lead</>}
            </button>
            <Link href="/admin/leads"
              className="w-full h-11 flex items-center justify-center bg-[var(--line-soft)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold hover:bg-[var(--line)] transition">
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}
