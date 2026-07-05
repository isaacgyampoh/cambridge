'use client'
import { useState, useEffect, use } from 'react'

export default function FlyerLanding({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [flyer, setFlyer] = useState<any>(null)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<'choose' | 'interest'>('choose')
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch(`/api/flyers/public?id=${id}`).then(r => r.json()).then(d => {
      if (d.flyer) setFlyer(d.flyer); else setNotFound(true)
    }).catch(() => setNotFound(true))
  }, [id])

  async function submitInterest() {
    if (!form.full_name.trim() || (!form.phone.trim() && !form.email.trim())) return
    setBusy(true)
    const d = await fetch('/api/flyers/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flyer_id: id, ...form, course_interest: flyer?.course }),
    }).then(r => r.json())
    setBusy(false)
    if (d.success) setDone(true)
  }

  if (notFound) return <Center><p className="text-[15px] text-[var(--ink-soft)]">This flyer link is no longer available.</p></Center>
  if (!flyer) return <Center><div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" /></Center>

  return (
    <div className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <div className="max-w-md mx-auto px-4 py-8">
        {/* Flyer image */}
        <div className="rounded-2xl overflow-hidden border border-[var(--line)] shadow-[0_4px_24px_rgba(26,34,48,0.08)] mb-5 bg-white">
          <img src={flyer.image_url} alt={flyer.title || 'Cambridge Centre of Excellence'} className="w-full object-contain" />
        </div>

        {done ? (
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 text-center">
            <h2 className="font-display text-[20px] font-semibold text-[var(--ink)]">Thank you!</h2>
            <p className="text-[14px] text-[var(--ink-soft)] mt-2">{flyer.marketer_name || 'A course advisor'} will reach out to you shortly with all the details.</p>
          </div>
        ) : mode === 'choose' ? (
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6">
            <h1 className="font-display text-[20px] font-semibold text-[var(--ink)]">{flyer.title || 'Cambridge Centre of Excellence'}</h1>
            <p className="text-[14px] text-[var(--ink-soft)] mt-1.5 mb-5">{flyer.course ? `Interested in ${flyer.course}? ` : ''}Choose how you'd like to continue.</p>
            <div className="space-y-2.5">
              <button onClick={() => setMode('interest')}
                className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 transition">
                I have questions — contact me
              </button>
              {flyer.marketer_code && (
                <a href={`/apply/${flyer.marketer_code}`}
                  className="block w-full h-12 rounded-xl border border-[var(--line)] text-[var(--ink)] font-semibold text-[15px] flex items-center justify-center hover:bg-[var(--canvas)] transition">
                  Register &amp; pay now
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6">
            <h2 className="font-display text-[18px] font-semibold text-[var(--ink)] mb-1">Leave your details</h2>
            <p className="text-[13px] text-[var(--ink-soft)] mb-4">{flyer.marketer_name || 'Our team'} will reach out to you.</p>
            <div className="space-y-3">
              <Field label="Full name" value={form.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} placeholder="Your name" />
              <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="024 000 0000" />
              <Field label="Email (optional)" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="you@email.com" />
              <button onClick={submitInterest} disabled={busy || !form.full_name.trim()}
                className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 disabled:opacity-50 transition">
                {busy ? 'Submitting…' : 'Submit'}
              </button>
              <button onClick={() => setMode('choose')} className="w-full text-[13px] text-[var(--ink-faint)] font-medium">Back</button>
            </div>
          </div>
        )}

        <p className="text-center text-[12px] text-[var(--ink-faint)] mt-5">Cambridge Centre of Excellence</p>
      </div>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--canvas)' }}>{children}</div>
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-[14px] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition" />
    </div>
  )
}
