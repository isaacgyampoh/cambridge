'use client'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Dialog } from '@/components/ui/overlays'
import { Button, Field, inputClass, textareaClass } from '@/components/ui'
import type { Batch, Course } from '@/types'

/**
 * Registering a student who was signed up at the desk.
 *
 * The form keeps everything typed when the server rejects it. Somebody has
 * just read a form off a piece of paper; clearing it because a date was
 * mistyped means reading the whole thing again, and that is how a wrong
 * record gets saved the second time.
 */

type Props = {
  open: boolean
  onClose: () => void
  courses: Course[]
  batches: Batch[]
  /** Called after a successful save, so the list behind can reload. */
  onRegistered: () => void
}

type Fields = Record<string, string>

const EMPTY: Fields = {
  fullName: '', phone: '', email: '', gender: '', dateOfBirth: '',
  courseId: '', delivery: '', batchId: '', registrationDate: '', notes: '',
}

export function ManualRegistrationDialog({ open, onClose, courses, batches, onRegistered }: Props) {
  const [v, setV] = useState<Fields>({ ...EMPTY, registrationDate: new Date().toISOString().slice(0, 10) })
  const [errors, setErrors] = useState<Fields>({})
  const [saving, setSaving] = useState(false)
  const errId = useId()

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV(s => ({ ...s, [k]: e.target.value }))
    // Clear this field's error as soon as it is touched; leave the others.
    setErrors(s => (s[k] ? { ...s, [k]: '' } : s))
  }

  const active = courses.filter(c => c.is_active)
  // Only classes belonging to the chosen programme can be offered.
  const forCourse = v.courseId
    ? batches.filter(b => !b.course_id || b.course_id === v.courseId)
    : []

  function reset() {
    setV({ ...EMPTY, registrationDate: new Date().toISOString().slice(0, 10) })
    setErrors({})
  }

  async function save() {
    // Guards a double tap: the button is disabled, and so is the handler.
    if (saving) return
    setSaving(true)
    setErrors({})
    try {
      const res = await fetch('/api/academics/manual-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      const d = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (d.fields) setErrors(d.fields)
        toast.error(d.error || 'That student could not be registered.')
        return
      }

      toast.success(
        d.admissionNumber
          ? `${v.fullName} registered — admission number ${d.admissionNumber}.`
          : `${v.fullName} registered.`,
      )
      /*
       * Said out loud, because it is the thing most likely to be silently
       * wrong and the person who just typed the form is the only one who
       * would notice.
       */
      if (!d.visibleToAccounts) {
        toast.error('Registered, but no fee record was created — tell Accounts before they look for it.')
      }
      reset()
      onRegistered()
      onClose()
    } catch {
      toast.error('The server could not be reached. Nothing was saved.')
    } finally {
      setSaving(false)
    }
  }

  const err = (k: string) =>
    errors[k]
      ? <p id={`${errId}-${k}`} className="text-[12px] text-[var(--danger)] mt-1.5">{errors[k]}</p>
      : null

  const aria = (k: string) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${errId}-${k}` : undefined,
  })

  return (
    <Dialog
      open={open}
      onClose={() => { if (!saving) { reset(); onClose() } }}
      title="Register a student manually"
      description="For students signed up at the desk who never used the online form. They will appear in Accounts with their fee owing."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose() }} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save student'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name" required>
          <input className={inputClass} value={v.fullName} onChange={set('fullName')}
            placeholder="Kwame Boateng" autoComplete="off" {...aria('fullName')} />
          {err('fullName')}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Phone" required hint="how the centre reaches them">
            <input className={inputClass} value={v.phone} onChange={set('phone')}
              placeholder="024 123 4567" inputMode="tel" {...aria('phone')} />
            {err('phone')}
          </Field>
          <Field label="Email" hint="optional">
            <input className={inputClass} value={v.email} onChange={set('email')}
              placeholder="Leave empty if they have none" inputMode="email" {...aria('email')} />
            {err('email')}
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Gender" hint="optional">
            <select className={inputClass} value={v.gender} onChange={set('gender')} {...aria('gender')}>
              <option value="">Not recorded</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
            {err('gender')}
          </Field>
          <Field label="Date of birth" hint="optional">
            <input type="date" className={inputClass} value={v.dateOfBirth} onChange={set('dateOfBirth')} {...aria('dateOfBirth')} />
            {err('dateOfBirth')}
          </Field>
        </div>

        <Field label="Programme" required>
          <select className={inputClass} value={v.courseId}
            onChange={e => { setV(s => ({ ...s, courseId: e.target.value, batchId: '' })); setErrors(s => ({ ...s, courseId: '' })) }}
            {...aria('courseId')}>
            <option value="">Choose a programme</option>
            {active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {err('courseId')}
        </Field>

        <Field label="Attending" required hint="decides which fee applies">
          <select className={inputClass} value={v.delivery} onChange={set('delivery')} {...aria('delivery')}>
            <option value="">Choose</option>
            <option value="in_person">In person</option>
            <option value="online">Online</option>
          </select>
          {err('delivery')}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Class" hint={v.courseId ? 'optional' : 'choose a programme first'}>
            <select className={inputClass} value={v.batchId} onChange={set('batchId')}
              disabled={!v.courseId} {...aria('batchId')}>
              <option value="">Not assigned yet</option>
              {forCourse.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {err('batchId')}
          </Field>
          <Field label="Registration date" hint="defaults to today">
            <input type="date" className={inputClass} value={v.registrationDate}
              onChange={set('registrationDate')} {...aria('registrationDate')} />
            {err('registrationDate')}
          </Field>
        </div>

        <Field label="Note" hint="optional — kept on the student's record">
          <textarea className={textareaClass} rows={2} value={v.notes} onChange={set('notes')}
            placeholder="Anything Accounts or the trainer should know." {...aria('notes')} />
          {err('notes')}
        </Field>

        <div className="rounded-2xl bg-[var(--canvas)] border border-[var(--line)] p-3 text-[12px] text-[var(--ink-soft)] leading-relaxed">
          Saving creates the student record, an admission number and a fee entry
          showing the full amount <strong>owing</strong>. No payment is recorded —
          Accounts enters what the student has paid on the Student fees screen.
        </div>
      </div>
    </Dialog>
  )
}
