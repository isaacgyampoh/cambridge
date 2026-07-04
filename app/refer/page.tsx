'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function ReferInner() {
  const params = useSearchParams()
  const code = params.get('code')        // generic referral code
  const marketerCode = params.get('m')   // a marketer's personal link
  // A friend arriving via either link sees the interest form; otherwise the
  // generic "get your own link" flow.
  return (code || marketerCode) ? <FriendForm code={code} marketerCode={marketerCode} /> : <GetLink />
}

/* A referrer generates their shareable link */
function GetLink() {
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (!form.name.trim()) return
    setBusy(true)
    const d = await fetch('/api/referrals/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).then(r => r.json())
    setBusy(false)
    if (d.code) setLink(`${window.location.origin}/refer?code=${d.code}`)
  }
  function copy() { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const wa = `https://wa.me/?text=${encodeURIComponent(`Join me at Cambridge Centre of Excellence! Register your interest here: ${link}`)}`

  return (
    <Shell title="Refer a friend, earn rewards" subtitle="Share your link. When a friend you refer enrolls, you get rewarded.">
      {!link ? (
        <div className="space-y-4">
          <Input label="Your name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ama Owusu" />
          <Input label="Your phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="024 000 0000" />
          <Input label="Your email (optional)" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="you@email.com" />
          <button onClick={generate} disabled={busy || !form.name.trim()}
            className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 disabled:opacity-50 transition">
            {busy ? 'Creating…' : 'Get my referral link'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-[var(--accent-soft)] p-4 text-center">
            <div className="text-[13px] text-[var(--accent)] font-medium mb-1">Your referral link</div>
            <div className="text-[14px] text-[var(--ink)] break-all font-medium">{link}</div>
          </div>
          <button onClick={copy} className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 transition">{copied ? 'Copied!' : 'Copy link'}</button>
          <a href={wa} target="_blank" className="block w-full h-12 rounded-xl bg-[#25D366] text-white font-semibold text-[15px] flex items-center justify-center hover:opacity-90 transition">Share on WhatsApp</a>
          <p className="text-[13px] text-[var(--ink-faint)] text-center">Send this to friends. When they register and enroll, you earn a reward.</p>
        </div>
      )}
    </Shell>
  )
}

/* A referred friend submits their interest */
function FriendForm({ code, marketerCode }: { code: string | null; marketerCode: string | null }) {
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', course_interest: '' })
  const [courses, setCourses] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch('/api/courses/public').then(r => r.json()).then(d => setCourses(d.courses || [])).catch(() => {})
  }, [])

  async function submit() {
    if (!form.full_name.trim() || (!form.phone.trim() && !form.email.trim())) return
    setBusy(true)
    const d = await fetch('/api/referrals/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, code, marketerCode }) }).then(r => r.json())
    setBusy(false)
    if (d.success) setDone(true)
  }

  if (done) return (
    <Shell title="Thank you!" subtitle="We've received your details. Our team will reach out to you shortly.">
      <div className="text-center text-[14px] text-[var(--ink-soft)]">A course advisor will contact you soon about enrolling at Cambridge Centre of Excellence.</div>
    </Shell>
  )

  return (
    <Shell title="You've been invited" subtitle="A friend thinks you'd be a great fit for Cambridge Centre of Excellence. Register your interest below.">
      <div className="space-y-4">
        <Input label="Full name" value={form.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} placeholder="Your name" />
        <Input label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="024 000 0000" />
        <Input label="Email (optional)" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="you@email.com" />
        <Select label="Course of interest (optional)" value={form.course_interest} onChange={v => setForm(f => ({ ...f, course_interest: v }))} options={courses} placeholder="Select a course…" />
        <button onClick={submit} disabled={busy || !form.full_name.trim()}
          className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-semibold text-[15px] hover:brightness-110 disabled:opacity-50 transition">
          {busy ? 'Submitting…' : 'Register my interest'}
        </button>
      </div>
    </Shell>
  )
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--canvas)' }}>
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(155deg, #14636c 0%, #1a7a85 60%, #17707a 100%)' }}>
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 85% 0%, rgba(255,255,255,0.10), transparent 60%)' }} />
        <div className="relative max-w-md mx-auto px-4 pt-10 pb-20 text-center">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-white overflow-hidden p-1.5 mb-4 shadow-lg">
            <img src="/brand/logo.png" alt="Cambridge" className="w-full h-full object-contain" />
          </div>
          <h1 className="font-display text-white text-[24px] font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="text-white/70 text-[14px] mt-2 leading-relaxed">{subtitle}</p>
        </div>
      </div>
      <div className="max-w-md mx-auto px-4 -mt-12 pb-14 relative">
        <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] shadow-[0_4px_24px_rgba(26,34,48,0.06)] p-6">{children}</div>
      </div>
    </div>
  )
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-[14px] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition" />
    </div>
  )
}

function Select({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--ink-soft)] mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-[14px] bg-white focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition">
        <option value="">{placeholder || 'Select…'}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

export default function ReferPage() {
  return <Suspense fallback={<div className="min-h-screen" style={{ background: 'var(--canvas)' }} />}><ReferInner /></Suspense>
}
