'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PageHeader, Card, Button, Field, inputClass } from '@/components/ui'
import { useConfirm } from '@/hooks/useConfirm'

const FALLBACK_COURSES = ['Projects Management Professional','Corporate Training','Professional in Human Resources','Senior Professional in Human Resources','Software Agile Projects Management','Results-Based Monitoring and Evaluation','Other']

export default function MarketerNewLead() {
  const { confirm, dialog } = useConfirm()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [courses, setCourses] = useState<string[]>(FALLBACK_COURSES)
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', gender: '',
    city: '', course_interest: '', notes: '',
  })

  useEffect(() => {
    fetch('/api/courses/public').then(r => r.json()).then(d => {
      if (d.courses?.length) setCourses([...d.courses, 'Other'])
    }).catch(() => {})
  }, [])

  function set(key: string, val: string) { setForm(f => ({ ...f, [key]: val })) }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) { toast.error('Full name is required'); return }
    if (!form.phone.trim()) { toast.error('Phone number is required'); return }
    setSaving(true)

    /*
     * ── WHY THIS POSTS TO /api/leads/create ──────────────────────────────
     *
     * It used to post to /api/leads/import, the BULK route, which is guarded
     * by portals ['leads', 'pm_leads']. A marketing officer holds neither —
     * their lead portal is `my_leads` — so this form answered every marketer,
     * trainer, content manager and exam coordinator with
     *
     *     "You do not have access to this."
     *
     * for a lead they had gone out and found themselves. /api/leads/create
     * takes one lead, resolves the owner from the session, and runs the same
     * intake pipeline.
     *
     * The old `assigned_to: myId` is gone with it: it was read from
     * /api/auth/me and sent from the browser, which is not where attribution
     * should be decided. The server uses the session.
     */
    async function post(allowDuplicate: boolean) {
      const res = await fetch('/api/leads/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          gender: form.gender || null,
          city: form.city.trim() || null,
          course_interest: form.course_interest || null,
          notes: form.notes.trim() || null,
          source: 'manual',
          allowDuplicate,
        }),
      })
      const body = await res.json().catch(() => null)
      return { res, body }
    }

    try {
      let { res, body } = await post(false)

      // 409 means this phone or email is already a lead. The server says who,
      // and the operator decides — adding the same person twice is a
      // commission dispute, not a detail.
      if (res.status === 409 && body?.duplicate) {
        const proceed = await confirm({
          title: 'This person is already a lead',
          message: `${body.error} Adding them again creates a second record for the same person.`,
          confirmLabel: 'Add anyway',
        })
        if (!proceed) { setSaving(false); return }
        ;({ res, body } = await post(true))
      }

      /*
       * Never a silent failure. The submit handler used to read only
       * `d.error`, so any response without that field — a 500 HTML error
       * page, a redirect to sign-in, a dropped connection — was treated as
       * success and the marketer was told the lead had been added.
       */
      if (!res.ok || !body?.success) {
        toast.error(body?.error || 'This lead could not be added. Please check the details and try again.')
        setSaving(false)
        return
      }

      toast.success(`${form.full_name.trim()} added to your leads`)
      router.push('/marketer/leads')
    } catch {
      toast.error('We could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-in w-full max-w-3xl mx-auto">
      {dialog}
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
                {courses.map(c => <option key={c} value={c}>{c}</option>)}
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
