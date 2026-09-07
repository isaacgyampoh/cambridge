'use client'
import { useState, useEffect } from 'react'
import type { PublicFlyer } from '@/lib/flyers/publicFlyer'
import { BRAND } from '@/lib/brand'

/**
 * The part of the flyer page a person interacts with.
 *
 * The flyer itself arrives as a prop, already read on the server, so the page
 * is rendered before it reaches the browser — which is what lets WhatsApp and
 * Facebook see the flyer when the link is shared, and what stops a person on
 * a slow connection watching a spinner before they see anything.
 */
export default function FlyerLanding({ flyer }: { flyer: PublicFlyer }) {
  const id = flyer.id
  const [mode, setMode] = useState<'choose' | 'interest'>('choose')
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  /*
   * Count the view.
   *
   * From the browser, on purpose: the server render also runs for link
   * crawlers, and a flyer pasted into a WhatsApp group is fetched by their
   * servers several times. Counting those would make a marketer's numbers
   * meaningless. This fires once, from a real browser.
   */
  useEffect(() => {
    fetch(`/api/flyers/public?id=${encodeURIComponent(id)}`).catch(() => {})
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

  return (
    <div className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <div className="max-w-md mx-auto px-4 py-8">
        {/* The flyer. Only rendered when there is one — an <img> with a null
            src shows the browser's broken-image glyph. */}
        {flyer.imageUrl && (
          <div className="rounded-2xl overflow-hidden border border-[var(--line)]
            shadow-[var(--shadow-raised)] mb-5 bg-[var(--paper)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flyer.imageUrl} alt={flyer.title || BRAND.name}
              className="w-full object-contain" />
          </div>
        )}

        {done ? (
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 text-center">
            <h2 className="font-display text-[17px] font-semibold text-[var(--ink)]">Thank you!</h2>
            <p className="text-[14px] text-[var(--ink-soft)] mt-2">{flyer.marketerName || 'A course advisor'} will reach out to you shortly with all the details.</p>
          </div>
        ) : mode === 'choose' ? (
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6">
            <h1 className="font-display text-[17px] font-semibold text-[var(--ink)]">{flyer.title || BRAND.name}</h1>
            <p className="text-[14px] text-[var(--ink-soft)] mt-1.5 mb-5">{flyer.course ? `Interested in ${flyer.course}? ` : ''}Choose how you’d like to continue.</p>
            <div className="space-y-2.5">
              <button onClick={() => setMode('interest')}
                className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 transition">
                I have questions — contact me
              </button>
              {flyer.marketerCode && (
                <a href={`/apply/${flyer.marketerCode}`}
                  className="block w-full h-12 rounded-2xl border border-[var(--line)] text-[var(--ink)] font-semibold text-[15px] flex items-center justify-center hover:bg-[var(--canvas)] transition">
                  Register &amp; pay now
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6">
            <h2 className="font-display text-[17px] font-semibold text-[var(--ink)] mb-1">Leave your details</h2>
            <p className="text-[13px] text-[var(--ink-soft)] mb-4">{flyer.marketerName || 'Our team'} will reach out to you.</p>
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

        <p className="text-center text-[12px] text-[var(--ink-faint)] mt-5">{BRAND.name}</p>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-11 px-4 rounded-2xl border border-[var(--line)] text-[14px] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition" />
    </div>
  )
}
