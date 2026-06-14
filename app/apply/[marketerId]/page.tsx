'use client'
import { CONFIG } from '@/lib/config'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, Course } from '@/types'
import { toast } from 'sonner'
import Script from 'next/script'

const PROGRAMS = ['PMP', 'PRINCE2', 'Agile/Scrum', 'Data Analytics', 'Cyber Security', 'Cloud Computing', 'Business Analysis', 'Other']

export default function ApplicationPage({ params }: { params: Promise<{ marketerId: string }> }) {
  const { marketerId } = use(params)
  const [marketer, setMarketer] = useState<Profile | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [step, setStep] = useState(1) // 1=form, 2=payment, 3=success
  const [submitting, setSubmitting] = useState(false)
  const [applicationId, setApplicationId] = useState<string | null>(null)

  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', gender: '',
    date_of_birth: '', country: 'Ghana', city: '', address: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    course_id: '', batch_preference: '',
    scholarship_requested: false, scholarship_type: '', scholarship_reason: '',
    passport_photo_url: '',
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
    if (!form.full_name || !form.email || !form.phone || !form.course_id) {
      toast.error('Please fill in all required fields')
      return
    }
    setSubmitting(true)

    const { data: app, error } = await sb.from('applications').insert({
      marketer_id: marketer?.id || null,
      full_name: form.full_name,
      email: form.email,
      phone: form.phone.replace(/^0/, '233'),
      gender: form.gender || null,
      date_of_birth: form.date_of_birth || null,
      country: form.country,
      city: form.city || null,
      address: form.address || null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      course_id: form.course_id,
      batch_preference: form.batch_preference || null,
      scholarship_requested: form.scholarship_requested,
      scholarship_type: form.scholarship_requested ? form.scholarship_type || null : null,
      scholarship_reason: form.scholarship_reason || null,
      passport_photo_url: form.passport_photo_url || null,
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
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--canvas)" }}>
      <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: "var(--accent-soft)" }}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M8 20L16 28L32 12" stroke="#1d4d44" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 className="font-display text-2xl font-semibold text-[var(--ink)] mb-2">Application received</h1>
        <p className="text-[var(--ink-soft)] mb-2">Welcome to Cambridge Centre of Excellence, {form.full_name.split(' ')[0]}.</p>
        <p className="text-sm text-[var(--ink-faint)]">Our admissions team will review your application and contact you within 24 hours.</p>
      </div>
    </div>
  )

  return (
    <>
      <Script src="https://js.paystack.co/v2/inline.js" strategy="lazyOnload" />
      <div className="min-h-screen py-10 px-4" style={{ background: "var(--canvas)" }}>
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4" style={{ background: "var(--accent)" }}>
              <span className="text-white text-lg font-semibold">CCE</span>
            </div>
            <h1 className="font-display text-[var(--ink)] text-2xl font-semibold">Cambridge Centre of Excellence</h1>
            <p className="text-[var(--ink-soft)] text-sm mt-1">Student registration</p>
            {marketer && (
              <p className="text-[var(--ink-faint)] text-xs mt-2">Referred by {marketer.full_name}</p>
            )}
          </div>

          {step === 1 && (
            <div className="bg-[var(--paper)] rounded-2xl border border-[var(--line)] p-6 lg:p-8">
              <h2 className="text-lg font-bold text-gray-900 mb-6">Personal Information</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {[
                  { key: 'full_name', label: 'Full Name *', placeholder: 'John Mensah', type: 'text', full: true },
                  { key: 'email', label: 'Email Address *', placeholder: 'john@example.com', type: 'email' },
                  { key: 'phone', label: 'Phone Number *', placeholder: '024 000 0000', type: 'tel' },
                  { key: 'date_of_birth', label: 'Date of Birth', placeholder: '', type: 'date' },
                  { key: 'city', label: 'City', placeholder: 'Accra', type: 'text' },
                  { key: 'address', label: 'Address', placeholder: 'Street, Area', type: 'text' },
                  { key: 'emergency_contact_name', label: 'Emergency Contact Name', placeholder: 'Jane Mensah', type: 'text' },
                  { key: 'emergency_contact_phone', label: 'Emergency Contact Phone', placeholder: '024 000 0001', type: 'tel' },
                ].map(f => (
                  <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{f.label}</label>
                    <input type={f.type} placeholder={f.placeholder}
                      value={(form as any)[f.key]}
                      onChange={e => set(f.key, e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
                  </div>
                ))}

                {/* Gender */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Gender</label>
                  <select value={form.gender} onChange={e => set('gender', e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] bg-white">
                    <option value="">Select...</option>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>

                {/* Program */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Program *</label>
                  <select value={form.course_id} onChange={e => set('course_id', e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--accent)] bg-white">
                    <option value="">Select program...</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Scholarship */}
              <div className="border-t border-gray-100 pt-5 mb-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.scholarship_requested}
                    onChange={e => set('scholarship_requested', e.target.checked)}
                    className="w-4 h-4 rounded accent-[var(--accent)]" />
                  <span className="text-sm font-semibold text-gray-700">I am requesting a scholarship</span>
                </label>
                {form.scholarship_requested && (
                  <div className="mt-4 space-y-3">
                    <select value={form.scholarship_type} onChange={e => set('scholarship_type', e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-[var(--line)] text-sm bg-white focus:outline-none focus:border-[var(--accent)]">
                      <option value="">Scholarship type...</option>
                      <option value="full">Full Scholarship</option>
                      <option value="partial">Partial Scholarship</option>
                    </select>
                    <textarea value={form.scholarship_reason} onChange={e => set('scholarship_reason', e.target.value)}
                      placeholder="Please explain why you are requesting a scholarship..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-[var(--line)] text-sm resize-none focus:outline-none focus:border-[var(--accent)]" />
                  </div>
                )}
              </div>

              {/* Payment method */}
              <div className="border-t border-gray-100 pt-5 mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Registration Fee — GHS 200</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'paystack', label: 'Pay Online', sub: 'MoMo or Card' },
                    { value: 'cash', label: 'Pay Cash', sub: 'At the office' },
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
              </div>

              <button onClick={submitForm} disabled={submitting}
                className="w-full h-12 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50 transition flex items-center justify-center gap-2">
                {submitting
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin" />Submitting…</>
                  : form.payment_method === 'paystack' ? 'Continue to Payment →' : 'Submit Application'
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
