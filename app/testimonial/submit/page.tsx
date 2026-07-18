'use client'
import { uploadFile } from '@/lib/upload'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast, Toaster } from 'sonner'
import { CONFIG } from '@/lib/config'

function SubmitForm() {
  const params = useSearchParams()
  const token = params.get('t') || ''
  const [form, setForm] = useState({ student_name: '', role_title: '', program_name: '', quote: '', image_url: '' })
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function uploadPhoto(file: File) {
    if (file.size > 8 * 1024 * 1024) { toast.error('Image too large (max 8MB)'); return }
    setUploading(true)
    try {
      const res = await uploadFile(file, 'testimonials')
      if (res.url) { set('image_url', res.url); toast.success('Photo added') }
      else throw new Error('Upload failed')
    } catch { toast.error('Could not upload photo') }
    finally { setUploading(false) }
  }

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
        <img src="/brand/logo.png" alt="Cambridge Center of Excellence" style={{ width: 64, height: 64, objectFit: 'contain', margin: '0 auto 16px' }} />
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1a2230', margin: '0 0 8px' }}>Thank you!</h1>
        <p style={{ color: '#4a5568', fontSize: 15 }}>Your testimonial has been received. We may feature it on our social pages.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <img src="/brand/logo.png" alt="Cambridge Center of Excellence" style={{ width: 60, height: 60, objectFit: 'contain', margin: '0 auto 12px' }} />
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
        <Field label="Course you completed (optional)">
          <input value={form.program_name} onChange={e => set('program_name', e.target.value)} placeholder="e.g. PMP, PHRi" style={inp} />
        </Field>
        <Field label="Your testimonial *">
          <textarea value={form.quote} onChange={e => set('quote', e.target.value)} rows={4} placeholder="What did you gain from the programme?" style={{ ...inp, resize: 'none' as const }} />
        </Field>
        <Field label="Your photo (optional)">
          {form.image_url ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={form.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} />
              <button type="button" onClick={() => set('image_url', '')} style={{ background: 'none', border: 'none', color: '#d85a30', fontSize: 13, cursor: 'pointer' }}>Remove</button>
            </div>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 10, border: '1px dashed #cbd5e1', fontSize: 14, color: '#4a5568', cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : 'Tap to add a photo'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
            </label>
          )}
        </Field>
        <button onClick={submit} disabled={submitting}
          style={{ width: '100%', height: 46, background: '#2f80d6', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Sending…' : 'Send my testimonial'}
        </button>
      </div>
      <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 20 }}>Cambridge Center of Excellence</p>
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
