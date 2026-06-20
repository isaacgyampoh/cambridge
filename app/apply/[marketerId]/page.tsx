'use client'
import { CONFIG } from '@/lib/config'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, Course } from '@/types'
import { toast } from 'sonner'
import Script from 'next/script'
import { Check } from 'lucide-react'

const PROGRAMS = ['PMP', 'PRINCE2', 'Agile/Scrum', 'Data Analytics', 'Cyber Security', 'Cloud Computing', 'Business Analysis', 'Other']

export default function ApplicationPage({ params }: { params: Promise<{ marketerId: string }> }) {
  const { marketerId } = use(params)
  const [marketer, setMarketer] = useState<Profile | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [step, setStep] = useState(1) // 1=form, 2=payment, 3=success
  const [submitting, setSubmitting] = useState(false)
  const [applicationId, setApplicationId] = useState<string | null>(null)

  const [form, setForm] = useState({
    // Name
    first_name: '', middle_name: '', last_name: '',
    // Personal
    date_of_birth: '', gender: '', country_of_birth: '', nationality: '',
    // Contact
    email: '', phone: '', postal_address: '', residential_address: '',
    // Education
    last_school: '', certification_attained: '', course_of_study: '', year_completed: '',
    // Programme + payment
    course_id: '', batch_preference: '', delivery: 'in_person',
    payment_method: 'paystack',
  })

  const sb = createClient()

  useEffect(() => {
    async function load() {
      // Get marketer by code
      const { data: m } = await sb.from('profiles')
        .select('*').eq('marketer_code', marketerId).single()
      setMarketer(m)

      const { data: c } = await sb.from('courses').select('*').eq('is_active', true)
      setCourses(c || [])
    }
    load()
  }, [marketerId])

  function set(key: string, value: any) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function submitForm() {
    if (!form.first_name || !form.last_name || !form.email || !form.phone || !form.course_id) {
      toast.error('Please fill in your name, email, phone and programme')
      return
    }
    setSubmitting(true)

    const fullName = [form.first_name, form.middle_name, form.last_name].filter(Boolean).join(' ')

    const { data: app, error } = await sb.from('applications').insert({
      marketer_id: marketer?.id || null,
      full_name: fullName,
      first_name: form.first_name,
      middle_name: form.middle_name || null,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone.replace(/^0/, '233'),
      gender: form.gender || null,
      date_of_birth: form.date_of_birth || null,
      country_of_birth: form.country_of_birth || null,
      nationality: form.nationality || null,
      postal_address: form.postal_address || null,
      residential_address: form.residential_address || null,
      address: form.residential_address || null,
      last_school: form.last_school || null,
      certification_attained: form.certification_attained || null,
      course_of_study: form.course_of_study || null,
      year_completed: form.year_completed || null,
      course_id: form.course_id,
      batch_preference: form.batch_preference || null,
      delivery: form.delivery,
      payment_method: form.payment_method as any,
      payment_status: 'pending',
    }).select().single()

    if (error) {
      toast.error('Failed to submit application: ' + error.message)
      setSubmitting(false)
      return
    }

    setApplicationId(app.id)

    if (form.payment_method === 'cash') {
      // Mark as pending cash, submit immediately
      await sb.from('applications').update({ is_submitted: true, submitted_at: new Date().toISOString() }).eq('id', app.id)
      setStep(3)
    } else {
      setStep(2) // Go to payment
    }
    setSubmitting(false)
  }

  async function payWithPaystack() {
    const ps = (window as any).PaystackPop
    if (!ps || !applicationId) return

    ps.setup({
      key: CONFIG.paystackPublicKey,
      email: form.email,
      amount: 20000, // GHS 200 in pesewas
      currency: 'GHS',
      ref: `CCE-APP-${applicationId}-${Date.now()}`,
      channels: ['mobile_money', 'card'],
      callback: async (response: any) => {
        // Verify and update
        await sb.from('applications').update({
          payment_status: 'paid',
          paystack_ref: response.reference,
          paid_at: new Date().toISOString(),
          amount_paid: 200,
          is_submitted: true,
          submitted_at: new Date().toISOString(),
        }).eq('id', applicationId)

        // Trigger admission via API
        const { data: app } = await sb.from('applications').select('*').eq('id', applicationId).single()
        if (app) {
          await fetch('/api/applications/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicationId }),
          })
        }
        setStep(3)
      },
      onClose: () => toast.info('Payment closed. You can pay later.'),
    }).openIframe()
  }

  if (step === 3) return (
    <FeePayStep applicationId={applicationId} firstName={form.first_name} />
  )

  return (
    <>
      <Script src="https://js.paystack.co/v2/inline.js" strategy="lazyOnload" />
      <div className="min-h-screen py-10 px-4" style={{ background: "var(--canvas)" }}>
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4 bg-white border border-[var(--line)] overflow-hidden p-1.5">
              <img src="/brand/logo.png" alt="Cambridge Centre of Excellence" className="w-full h-full object-contain" />
            </div>
            <h1 className="font-display text-[var(--ink)] text-2xl font-semibold">Cambridge Centre of Excellence</h1>
            <p className="text-[var(--ink-soft)] text-sm mt-1">Student registration</p>
            {marketer && (
              <p className="text-[var(--ink-faint)] text-xs mt-2">Referred by {marketer.full_name}</p>
            )}
          </div>

          {step === 1 && (
            <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 lg:p-8">
              <h2 className="text-lg font-bold text-gray-900 mb-1">Details to complete your registration</h2>
              <p className="text-sm text-[var(--ink-soft)] mb-6">Please fill in your information accurately.</p>

              {/* Name */}
              <p className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wide mb-3">Full name</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {[
                  { key: 'first_name', label: 'First name *', placeholder: 'John' },
                  { key: 'middle_name', label: 'Middle name', placeholder: '' },
                  { key: 'last_name', label: 'Last name *', placeholder: 'Mensah' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{f.label}</label>
                    <input type="text" placeholder={f.placeholder} value={(form as any)[f.key]}
                      onChange={e => set(f.key, e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
                  </div>
                ))}
              </div>

              {/* Personal */}
              <p className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wide mb-3">Personal</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date of birth</label>
                  <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Gender</label>
                  <select value={form.gender} onChange={e => set('gender', e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] bg-white">
                    <option value="">Select...</option>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
                {[
                  { key: 'country_of_birth', label: 'Country of birth', placeholder: 'Ghana' },
                  { key: 'nationality', label: 'Nationality', placeholder: 'Ghanaian' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{f.label}</label>
                    <input type="text" placeholder={f.placeholder} value={(form as any)[f.key]}
                      onChange={e => set(f.key, e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
                  </div>
                ))}
              </div>

              {/* Contact */}
              <p className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wide mb-3">Contact</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {[
                  { key: 'email', label: 'Email address *', placeholder: 'john@example.com', type: 'email' },
                  { key: 'phone', label: 'Phone number *', placeholder: '024 000 0000', type: 'tel' },
                  { key: 'postal_address', label: 'Postal address', placeholder: 'P.O. Box ...', type: 'text' },
                  { key: 'residential_address', label: 'Residential address', placeholder: 'Street, Area, City', type: 'text' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{f.label}</label>
                    <input type={f.type} placeholder={f.placeholder} value={(form as any)[f.key]}
                      onChange={e => set(f.key, e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
                  </div>
                ))}
              </div>

              {/* Education */}
              <p className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wide mb-3">Education background</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {[
                  { key: 'last_school', label: 'Last school attended', placeholder: 'e.g. University of Ghana' },
                  { key: 'certification_attained', label: 'Certification attained', placeholder: 'e.g. BSc, Diploma, WASSCE' },
                  { key: 'course_of_study', label: 'Course of study', placeholder: 'e.g. Business Administration' },
                  { key: 'year_completed', label: 'Year completed', placeholder: 'e.g. 2020' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{f.label}</label>
                    <input type="text" placeholder={f.placeholder} value={(form as any)[f.key]}
                      onChange={e => set(f.key, e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
                  </div>
                ))}
              </div>

              {/* Programme */}
              <p className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wide mb-3">Programme</p>
              <div className="grid grid-cols-1 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Programme you're registering for *</label>
                  <select value={form.course_id} onChange={e => set('course_id', e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] bg-white">
                    <option value="">Select programme...</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">How will you attend? *</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { value: 'online', label: 'Online', sub: 'Join classes via Zoom' },
                      { value: 'in_person', label: 'In-person', sub: 'Attend at the campus' },
                    ].map(d => (
                      <button key={d.value} type="button" onClick={() => { set('delivery', d.value); if (d.value === 'online') set('payment_method', 'paystack') }}
                        className={`text-left px-4 py-3 rounded-xl border transition ${form.delivery === d.value ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--ink-faint)]'}`}>
                        <div className="text-sm font-bold text-gray-900">{d.label}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">{d.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Payment method */}
              <div className="border-t border-gray-100 pt-5 mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Registration Fee — GHS 200</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'paystack', label: 'Pay Online', sub: 'MoMo or Card' },
                    // Online students must pay the registration fee online (no cash)
                    ...(form.delivery === 'online' ? [] : [{ value: 'cash', label: 'Pay Cash', sub: 'At the office' }]),
                  ].map(m => (
                    <button key={m.value} type="button" onClick={() => set('payment_method', m.value)}
                      className={`p-3 rounded-xl border-2 text-left transition ${
                        form.payment_method === m.value ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] hover:border-[var(--ink-faint)]'
                      }`}>
                      <div className="text-sm font-bold text-gray-900">{m.label}</div>
                      <div className="text-xs text-gray-500">{m.sub}</div>
                    </button>
                  ))}
                </div>
                {form.delivery === 'online' && (
                  <p className="text-[11px] text-[var(--ink-faint)] mt-2">Online students pay the registration fee by MoMo or card.</p>
                )}
              </div>

              <button onClick={submitForm} disabled={submitting}
                className="w-full h-12 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2">
                {submitting
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin" />Submitting…</>
                  : form.payment_method === 'paystack' ? 'Continue to Payment' : 'Submit Application'
                }
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-8 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: "var(--accent-soft)" }}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path d="M4 16C4 9.37 9.37 4 16 4s12 5.37 12 12-5.37 12-12 12S4 22.63 4 16z" stroke="#2563eb" strokeWidth="2"/>
                  <path d="M10 16h12M16 10v12" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Pay Registration Fee</h2>
              <p className="text-gray-500 mb-2">Registration fee: <span className="font-bold text-gray-900">GHS 200</span></p>
              <p className="text-sm text-gray-400 mb-8">Complete payment to submit your application</p>
              <button onClick={payWithPaystack}
                className="w-full h-12 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:brightness-110 transition">
                Pay GHS 200 via Paystack
              </button>
              <p className="text-xs text-gray-400 mt-4">Secured by Paystack · Mobile Money & Card accepted</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Post-registration fee step: shows the course fee and offers
// pay now (MoMo / bank) or later. Appears right after registration. ──
function FeePayStep({ applicationId, firstName }: { applicationId: string | null; firstName: string }) {
  const [fee, setFee] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'intro' | 'method' | 'bank' | 'done'>('intro')
  const [amount, setAmount] = useState('')
  const [screenshot, setScreenshot] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<any>(null)

  useEffect(() => {
    if (!applicationId) { setLoading(false); return }
    let tries = 0
    const tick = async () => {
      const d = await fetch(`/api/fees/pay?applicationId=${applicationId}`).then(r => r.json()).catch(() => ({ found: false }))
      if (d.found) { setFee(d.fee); setAmount(String(d.fee.balance)); setLoading(false) }
      else if (tries++ < 5) setTimeout(tick, 1500)  // the ledger is created moments after payment webhook
      else setLoading(false)
    }
    tick()
  }, [applicationId])

  function payMomo() {
    const amt = Number(amount)
    if (!(amt > 0)) { toast.error('Enter an amount'); return }
    const ps = (window as any).PaystackPop
    if (!ps) { toast.error('Payment not available, please refresh'); return }
    ps.setup({
      key: CONFIG.paystackPublicKey,
      email: `${(fee.student_name || 'student').replace(/\s+/g, '').toLowerCase()}@cce.edu.gh`,
      amount: Math.round(amt * 100), currency: 'GHS',
      ref: `CCE-FEE-${fee.id}-${Date.now()}`,
      channels: ['mobile_money', 'card'],
      callback: (res: any) => record('momo', amt, res.reference),
      onClose: () => {},
    }).openIframe()
  }

  async function record(method: string, amt: number, paystackRef?: string, screenshotUrl?: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/fees/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentFeeId: fee.id, amount: amt, method, paystackRef, screenshotUrl }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      setReceipt(res); setView('done')
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }

  async function uploadShot(file: File) {
    if (!CONFIG.cloudinaryCloudName || !CONFIG.cloudinaryUploadPreset) { toast.error('Upload not available'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('upload_preset', CONFIG.cloudinaryUploadPreset); fd.append('folder', 'cce/fee-proofs')
      const r = await fetch(`https://api.cloudinary.com/v1_1/${CONFIG.cloudinaryCloudName}/image/upload`, { method: 'POST', body: fd }).then(x => x.json())
      if (r.secure_url) setScreenshot(r.secure_url)
    } catch { toast.error('Upload failed') } finally { setUploading(false) }
  }

  const card = "bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-8 max-w-md w-full"
  const btn = "w-full h-12 rounded-xl font-semibold text-[15px] transition"

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-10" style={{ background: "var(--canvas)" }}>
      <Script src="https://js.paystack.co/v2/inline.js" strategy="lazyOnload" />
      <div className={card}>
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "var(--accent-soft)" }}>
            <svg width="34" height="34" viewBox="0 0 40 40" fill="none"><path d="M8 20L16 28L32 12" stroke="#2f80d6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <h1 className="font-display text-2xl font-semibold text-[var(--ink)] mb-1">You're registered, {firstName}!</h1>
          <p className="text-sm text-[var(--ink-soft)]">Your admission letter is on its way by WhatsApp.</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-[var(--ink-faint)]">Loading your fees…</p>
        ) : !fee || Number(fee.total_fee) <= 0 ? (
          <p className="text-center text-sm text-[var(--ink-faint)]">Our team will be in touch about your fees shortly.</p>
        ) : view === 'intro' ? (
          <>
            <div className="rounded-xl bg-[var(--canvas)] p-4 mb-4 text-center">
              <div className="text-xs text-[var(--ink-faint)] uppercase tracking-wide">Your course fee</div>
              <div className="font-display text-3xl font-semibold text-[var(--ink)] mt-1">GHS {Number(fee.total_fee).toFixed(2)}</div>
              {Number(fee.amount_paid) > 0 && <div className="text-xs text-emerald-600 mt-1">GHS {Number(fee.amount_paid).toFixed(2)} paid · balance GHS {Number(fee.balance).toFixed(2)}</div>}
            </div>
            <p className="text-center text-sm text-[var(--ink-soft)] mb-4">Would you like to pay now, or later?</p>
            <button onClick={() => setView('method')} className={btn + " bg-[var(--accent)] text-white mb-2.5"}>Pay now</button>
            <button onClick={() => setView('done')} className={btn + " bg-[var(--line-soft)] text-[var(--ink-soft)]"}>I'll pay later</button>
          </>
        ) : view === 'method' ? (
          <>
            <label className="block text-xs font-semibold text-[var(--ink-faint)] uppercase mb-1.5">Amount to pay</label>
            <p className="text-[11px] text-[var(--ink-faint)] mb-2">You can pay all or part of GHS {Number(fee.balance).toFixed(2)}.</p>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full h-12 px-4 rounded-xl border border-[var(--line)] text-[15px] mb-4 outline-none" />
            <button onClick={payMomo} disabled={busy} className={btn + " mb-2.5"} style={{ background: '#ffcc00', color: '#1a2230' }}>Mobile Money (MoMo)</button>
            <button onClick={() => setView('bank')} className={btn + " text-white"} style={{ background: '#1e3a8a' }}>Bank transfer</button>
          </>
        ) : view === 'bank' ? (
          <>
            <div className="rounded-xl bg-[var(--canvas)] p-4 mb-4 text-sm">
              <div className="font-semibold text-[var(--ink)] mb-1.5">Bank transfer details</div>
              <div className="text-[var(--ink-soft)]">Bank: <strong>{CONFIG.bankName}</strong></div>
              <div className="text-[var(--ink-soft)]">Account name: <strong>{CONFIG.bankAccountName}</strong></div>
              <div className="text-[var(--ink-soft)]">Account: <strong>{CONFIG.bankAccountNumber}</strong></div>
              {CONFIG.bankBranch && <div className="text-[var(--ink-soft)]">Branch: <strong>{CONFIG.bankBranch}</strong></div>}
              <div className="text-[11px] text-[var(--ink-faint)] mt-2">Transfer GHS {Number(amount).toFixed(2)}, then upload your screenshot. Finance will verify it.</div>
            </div>
            {screenshot ? (
              <div className="flex items-center gap-2 mb-3"><img src={screenshot} alt="" className="w-11 h-11 rounded-lg object-cover" /><span className="text-sm text-emerald-600">Screenshot attached</span></div>
            ) : (
              <label className="flex items-center justify-center h-12 rounded-xl border border-dashed border-[var(--line)] text-sm text-[var(--ink-soft)] cursor-pointer mb-3">
                {uploading ? 'Uploading…' : 'Upload payment screenshot'}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadShot(f) }} />
              </label>
            )}
            <button onClick={() => record('bank', Number(amount), undefined, screenshot)} disabled={busy || !screenshot} className={btn + " bg-[var(--accent)] text-white disabled:opacity-50"}>{busy ? 'Submitting…' : 'Submit for verification'}</button>
          </>
        ) : (
          <div className="text-center">
            {receipt ? (
              <>
                <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <Check size={24} className="text-emerald-600" strokeWidth={2.5} />
                </div>
                <h2 className="font-display text-lg font-semibold text-[var(--ink)] mb-1">{receipt.verified ? 'Payment received' : receipt.message}</h2>
                {receipt.receiptNo && <p className="text-sm text-[var(--ink-soft)]">Receipt: {receipt.receiptNo}</p>}
                {receipt.verified && <p className="text-sm text-[var(--ink-soft)] mt-1">{receipt.balance > 0 ? `Balance: GHS ${receipt.balance.toFixed(2)}` : 'Fully paid — thank you!'}</p>}
              </>
            ) : (
              <>
                <h2 className="font-display text-lg font-semibold text-[var(--ink)] mb-1">All set, {firstName}!</h2>
                <p className="text-sm text-[var(--ink-soft)]">You can pay your fees anytime. Our team will share the details.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
