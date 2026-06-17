'use client'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast, Toaster } from 'sonner'

function SubmitForm() {
  const params = useSearchParams()
  const token = params.get('t') || ''
  const [form, setForm] = useState({ student_name: '', role_title: '', quote: '', image_url: '' })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.student_name.trim() || !form.quote.trim()) { toast.error('Please add your name and your words'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/testimonials/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...form }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setDone(true)
    } catch (e: any) { toast.error(e.message) }
    finally { setSubmitting(false) }
  }

  if (done) {
    return (
      <div style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
        <img src="/brand/logo.png" alt="Cambridge Centre of Excellence" style={{ width: 64, height: 64, objectFit: 'contain', margin: '0 auto 16px' }} />
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1a2230', margin: '0 0 8px' }}>Thank you!</h1>
        <p style={{ color: '#4a5568', fontSize: 15 }}>Your testimonial has been received. We may feature it on our social pages.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <img src="/brand/logo.png" alt="Cambridge Centre of Excellence" style={{ width: 60, height: 60, objectFit: 'contain', margin: '0 auto 12px' }} />
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1a2230', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Share your experience</h1>
        <p style={{ color: '#4a5568', fontSize: 14 }}>We'd love to hear how your programme went. Your words may be featured on our socials.</p>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e6eaf0', padding: 24 }}>
        <Field label="Your name *">
          <input value={form.student_name} onChange={e => set('student_name', e.target.value)} placeholder="Full name" style={inp} />
        </Field>
        <Field label="Your role / title (optional)">
          <input value={form.role_title} onChange={e => set('role_title', e.target.value)} placeholder="e.g. HR Manager, Project Lead" style={inp} />
        </Field>
        <Field label="Your testimonial *">
          <textarea value={form.quote} onChange={e => set('quote', e.target.value)} rows={4} placeholder="What did you gain from the programme?" style={{ ...inp, resize: 'none' as const }} />
        </Field>
        <Field label="Your photo (optional)">
          <input value={form.image_url} onChange={e => set('image_url', e.target.value)} placeholder="Paste an image link" style={inp} />
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>You can paste a link to your photo (e.g. from Google Drive or a social profile).</p>
        </Field>
        <button onClick={submit} disabled={submitting}
          style={{ width: '100%', height: 46, background: '#2f80d6', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Sending…' : 'Send my testimonial'}
        </button>
      </div>
      <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 20 }}>Cambridge Centre of Excellence</p>
    </div>
  )
}

const inp: React.CSSProperties = { width: '100%', height: 44, padding: '0 14px', borderRadius: 10, border: '1px solid #e6eaf0', fontSize: 14, outline: 'none', boxSizing: 'border-box' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

export default function TestimonialSubmitPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f8fc', fontFamily: 'Inter, sans-serif' }}>
      <Toaster position="top-center" />
      <Suspense fallback={null}><SubmitForm /></Suspense>
    </div>
  )
}
