'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PageHeader, Card, Button, Field, inputClass } from '@/components/ui'

const COURSES = ['PMP','SPHRi/PHRi','aPHRi','CAPM','NGO Management','Project Financing','MS Project','Commercial Law','Instructor-led','Corporate Training','Other']

export default function MarketerNewLead() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [myId, setMyId] = useState<string | null>(null)
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', gender: '',
    city: '', course_interest: '', notes: '',
  })

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => { if (s.valid) setMyId(s.userId) })
  }, [])

  function set(key: string, val: string) { setForm(f => ({ ...f, [key]: val })) }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) { toast.error('Full name is required'); return }
    if (!form.phone.trim()) { toast.error('Phone number is required'); return }
    if (!myId) { toast.error('Could not identify your account'); return }
    setSaving(true)
    try {
      // Duplicate check
      if (form.phone.trim() || form.email.trim()) {
        const dup = await fetch('/api/leads/check-duplicate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: form.phone.trim(), email: form.email.trim() }),
        }).then(r => r.json()).catch(() => ({}))
        if (dup.duplicate) {
          const owner = dup.lead?.assignee?.full_name ? ` (currently with ${dup.lead.assignee.full_name})` : ''
          const proceed = confirm(`A lead "${dup.lead.full_name}" already exists with this phone/email${owner}. Add anyway?`)
          if (!proceed) { setSaving(false); return }
        }
      }

      const res = await fetch('/api/data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'leads',
          data: {
            full_name: form.full_name.trim(),
            phone: form.phone.trim().replace(/^0/, '233') || null,
            email: form.email.trim() || null,
            gender: form.gender || null,
            country: 'Ghana',
            city: form.city || null,
            source: 'manual',
            status: 'new',
            course_interest: form.course_interest || null,
            notes: form.notes || null,
            // Auto-assign to the marketer who created it
            assigned_to: myId,
            assigned_at: new Date().toISOString(),
          },
        }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)

      toast.success(`${form.full_name} added to your leads`)
      router.push('/marketer')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-in w-full max-w-3xl mx-auto">
      <PageHeader
        eyebrow="My work"
        title="Add a lead"
        description="Add someone you've sourced yourself. It's assigned to you automatically and counts toward your conversions."
      />

      <Card className="p-6">
        <form onSubmit={save} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" required>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="e.g. Ama Mensah" className={inputClass} />
            </Field>
            <Field label="Phone" required>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="e.g. 024 123 4567" className={inputClass} />
            </Field>
            <Field label="Email">
              <input value={form.email} onChange={e => set('email', e.target.value)} placeholder="optional" className={inputClass} />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={e => set('gender', e.target.value)} className={inputClass}>
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </Field>
            <Field label="City">
              <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="e.g. Accra" className={inputClass} />
            </Field>
            <Field label="Programme of interest">
              <select value={form.course_interest} onChange={e => set('course_interest', e.target.value)} className={inputClass}>
                <option value="">Select a programme</option>
                {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              placeholder="Anything useful about this lead..." className={inputClass + ' resize-none h-auto py-2.5'} />
          </Field>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add lead'}</Button>
            <Button type="button" variant="secondary" onClick={() => router.push('/marketer')}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
