'use client'
import { CONFIG } from '@/lib/config'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import Script from 'next/script'

type Step = 'name'| 'code'| 'fee'| 'payment'| 'done'

interface Session {
  id: string
  batch_id: string
  class_code: string
  session_date: string
  signin_open: boolean
  batches: { name: string; courses: { name: string; course_fee: number } }
}

interface FormState {
  full_name: string
  phone: string
  email: string
  attendance_type: 'in_person'| 'online'
  class_code: string
  payment_method: string
}

export default function SignInPage({ params, searchParams }: {
  params: Promise<{ batchId: string }>
  searchParams: Promise<{ m?: string }> // marketer id
}) {
  const { batchId } = use(params)
  const { m: marketerId } = use(searchParams)

  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>('name')
  const [signinId, setSigninId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({
    full_name: '', phone: '', email: '', attendance_type: 'in_person', class_code: '', payment_method: '',
  })
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const sb = createClient()

  useEffect(() => {
    async function load() {
      // Get today's session for this batch
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await sb.from('class_sessions')
        .select('*, batches(name, courses(name, course_fee))')
        .eq('batch_id', batchId)
        .eq('session_date', today)
        .eq('signin_open', true)
        .single()
      setSession(data as any)
      setLoading(false)
    }
    load()
  }, [batchId])

  // Search students by name as user types
  async function onNameChange(val: string) {
    setForm(f => ({ ...f, full_name: val }))
    if (val.length < 2) { setSuggestions([]); return }
    const { data } = await sb.from('profiles')
      .select('id, full_name, phone, email')
      .eq('role', 'student')
      .ilike('full_name', `%${val}%`)
      .limit(5)
    setSuggestions(data || [])
  }

  function selectSuggestion(s: any) {
    setForm(f => ({ ...f, full_name: s.full_name, phone: s.phone || f.phone, email: s.email || f.email }))
    setSuggestions([])
  }

  async function submitName() {
    if (!form.full_name.trim()) { setError('Please enter your name'); return }
    setError('')
    setSubmitting(true)

    // Create sign-in record
    const { data: signin, error: err } = await sb.from('class_signins').insert({
      session_id: session!.id,
      batch_id: batchId,
      marketer_id: marketerId || null,
      full_name: form.full_name.trim(),
      phone: form.phone.replace(/^0/, '233') || null,
      email: form.email || null,
      attendance_type: form.attendance_type,
    }).select().single()

    if (err) { setError('Something went wrong. Try again.'); setSubmitting(false); return }
    setSigninId(signin.id)
    setSubmitting(false)
    setStep('code')
  }

  async function submitCode() {
    if (!form.class_code.trim()) { setError('Please enter the class code from the board'); return }
    setError('')
    setSubmitting(true)

    const correct = form.class_code.trim().toUpperCase() === session!.class_code.toUpperCase()
    if (!correct) {
      setError('Incorrect class code. Please check the board and try again.')
      setSubmitting(false)
      return
    }

    await sb.from('class_signins').update({
      class_code_entered: form.class_code.trim().toUpperCase(),
      code_verified: true,
      verified_at: new Date().toISOString(),
    }).eq('id', signinId!)

    setSubmitting(false)
    setStep('fee')
  }

  async function selectPayment(method: string) {
    setForm(f => ({ ...f, payment_method: method }))
    await sb.from('class_signins').update({ payment_method: method }).eq('id', signinId!)

    if (method === 'cash'|| method === 'bank') {
      await sb.from('class_signins').update({
        payment_status: 'pending',
        payment_note: method === 'cash'? 'Please proceed to the front desk to make your cash payment.': 'Please make your bank transfer and present receipt at the front desk.',
      }).eq('id', signinId!)
      setStep('payment')
    } else if (method === 'momo') {
      setStep('payment')
    } else if (method === 'already_paid') {
      await sb.from('class_signins').update({ payment_status: 'paid', payment_method: 'already_paid', completed: true }).eq('id', signinId!)
      setStep('done')
    }
  }

  async function payWithPaystack() {
    const ps = (window as any).PaystackPop
    if (!ps) { setError('Payment not available. Please refresh.'); return }
    const fee = (session as any)?.batches?.courses?.course_fee || 0
    const key = CONFIG.paystackPublicKey

    ps.setup({
      key,
      email: form.email || `${form.phone}@cce.edu.gh`,
      amount: Math.round(fee * 100),
      currency: 'GHS',
      ref: `CCE-SIGNIN-${signinId}-${Date.now()}`,
      channels: ['mobile_money'],
      callback: async (res: any) => {
        await sb.from('class_signins').update({
          payment_status: 'paid',
          paystack_ref: res.reference,
          amount_paid: fee,
          paid_at: new Date().toISOString(),
          completed: true,
        }).eq('id', signinId!)
        setStep('done')
      },
      onClose: () => {},
    }).openIframe()
  }

  async function confirmCashPayment() {
    await sb.from('class_signins').update({ completed: true }).eq('id', signinId!)
    setStep('done')
  }

  const course = (session as any)?.batches?.courses
  const batchName = (session as any)?.batches?.name
  const fee = course?.course_fee || 0

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!session) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-lg">
        <div className="text-4xl mb-4"></div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">No Active Session</h2>
        <p className="text-gray-500 text-sm">There is no open sign-in session for today. Please check with your trainer.</p>
      </div>
    </div>
  )

  return (
    <>
      <Script src="https://js.paystack.co/v2/inline.js"strategy="lazyOnload" />
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 flex items-center justify-center p-4 py-8">
        <div className="w-full max-w-sm">

          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/20 backdrop-blur mb-3">
              <span className="text-white text-xl font-black">CC</span>
            </div>
            <h1 className="text-white font-bold text-lg">Cambridge Centre of Excellence</h1>
            <p className="text-blue-200 text-sm mt-0.5">{batchName} — {course?.name}</p>
            <p className="text-blue-300 text-xs mt-1">{new Date().toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})}</p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {['name', 'code', 'fee', 'done'].map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  ['name','code','fee','payment','done'].indexOf(step) >= i
                    ? 'bg-white text-blue-700'
                    : 'bg-white/20 text-white/50'
                }`}>{i + 1}</div>
                {i < 3 && <div className={`w-8 h-0.5 ${['name','code','fee','payment','done'].indexOf(step) > i ? 'bg-white': 'bg-white/20'}`} />}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-2xl">

            {/* ── STEP 1: Name ── */}
            {step === 'name'&& (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Welcome! Sign In</h2>
                <p className="text-gray-500 text-sm mb-5">Enter your name to check in for today's class.</p>

                <div className="space-y-3 mb-5">
                  {/* Name with autocomplete */}
                  <div className="relative">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Your Full Name *</label>
                    <input
                      value={form.full_name}
                      onChange={e => onNameChange(e.target.value)}
                      placeholder="Type your name..."
                      className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 text-[15px] focus:outline-none focus:border-blue-500 transition"
                    />
                    {suggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 z-10 overflow-hidden">
                        {suggestions.map(s => (
                          <button key={s.id} onClick={() => selectSuggestion(s)}
                            className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-50 last:border-0 transition">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
                              {s.full_name.charAt(0)}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-gray-900">{s.full_name}</div>
                              <div className="text-xs text-gray-400">{s.phone}</div>
                            </div>
                          </button>
                        ))}
                        <div className="px-4 py-2 bg-gray-50">
                          <p className="text-xs text-gray-400">Not you? Keep typing your full name</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Phone Number</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="024 000 0000"type="tel"inputMode="numeric"
                      className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 text-[15px] focus:outline-none focus:border-blue-500 transition" />
                  </div>

                  {/* Attendance type */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Attendance Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'in_person', label: 'In Person'},
                        { key: 'online', label: 'Online'},
                      ].map(t => (
                        <button key={t.key} type="button" onClick={() => setForm(f => ({ ...f, attendance_type: t.key as any }))}
                          className={`h-11 rounded-xl text-sm font-semibold border-2 transition ${
                            form.attendance_type === t.key ? 'border-blue-600 bg-blue-50 text-blue-700': 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {error && <p className="text-red-500 text-sm mb-3 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

                <button onClick={submitName} disabled={submitting || !form.full_name.trim()}
                  className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-[15px] hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {submitting ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in...</> : 'Continue →'}
                </button>
              </div>
            )}

            {/* ── STEP 2: Class Code ── */}
            {step === 'code'&& (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Enter Class Code</h2>
                <p className="text-gray-500 text-sm mb-5">Look at the board or screen in the classroom and enter the code shown.</p>

                <div className="mb-5">
                  <input
                    value={form.class_code}
                    onChange={e => setForm(f => ({ ...f, class_code: e.target.value.toUpperCase() }))}
                    placeholder="e.g. CCE-2503"
                    maxLength={12}
                    className="w-full h-16 px-4 rounded-xl border-2 border-gray-200 text-2xl font-bold text-center tracking-widest focus:outline-none focus:border-blue-500 transition uppercase"
                  />
                  <p className="text-xs text-gray-400 text-center mt-2">Code is written on the board by your trainer</p>
                </div>

                {error && <p className="text-red-500 text-sm mb-3 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

                <button onClick={submitCode} disabled={submitting || !form.class_code.trim()}
                  className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-[15px] hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {submitting ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Verifying...</> : 'Verify Code →'}
                </button>
              </div>
            )}

            {/* ── STEP 3: Fee ── */}
            {step === 'fee'&& (
              <div>
                <div className="text-center mb-5">
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg width="28"height="28"viewBox="0 0 28 28"fill="none"><path d="M5 14L11 20L23 8"stroke="#16a34a"strokeWidth="2.5"strokeLinecap="round"strokeLinejoin="round"/></svg>
                  </div>
                  <h2 className="text-lg font-bold text-gray-900">Attendance Confirmed! </h2>
                  <p className="text-gray-500 text-sm mt-1">Hi <strong>{form.full_name.split(' ')[0]}</strong>, you're signed in for today.</p>
                </div>

                {fee > 0 && (
                  <>
                    <div className="bg-blue-50 rounded-2xl p-4 mb-5 text-center">
                      <p className="text-sm text-gray-600 mb-1">Course fee due</p>
                      <p className="text-3xl font-black text-blue-700">GHS {fee.toFixed(2)}</p>
                      <p className="text-xs text-gray-400 mt-1">{course?.name}</p>
                    </div>

                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">How would you like to pay?</p>

                    <div className="space-y-2">
                      <button onClick={() => selectPayment('momo')}
                        className="w-full h-13 px-4 py-3 rounded-xl border-2 border-yellow-400 bg-yellow-50 text-left hover:bg-yellow-100 transition flex items-center justify-between">
                        <div>
                          <div className="font-bold text-gray-900 text-sm"> Mobile Money (MoMo)</div>
                          <div className="text-xs text-gray-500">Pay instantly with MTN, Telecel, or AirtelTigo</div>
                        </div>
                        <span className="text-yellow-600 font-bold text-sm">→</span>
                      </button>

                      <button onClick={() => selectPayment('cash')}
                        className="w-full h-13 px-4 py-3 rounded-xl border-2 border-green-200 bg-green-50 text-left hover:bg-green-100 transition flex items-center justify-between">
                        <div>
                          <div className="font-bold text-gray-900 text-sm"> Pay Cash</div>
                          <div className="text-xs text-gray-500">You will be directed to the front desk</div>
                        </div>
                        <span className="text-green-600 font-bold text-sm">→</span>
                      </button>

                      <button onClick={() => selectPayment('bank')}
                        className="w-full h-13 px-4 py-3 rounded-xl border-2 border-blue-200 bg-blue-50 text-left hover:bg-blue-100 transition flex items-center justify-between">
                        <div>
                          <div className="font-bold text-gray-900 text-sm"> Bank Transfer</div>
                          <div className="text-xs text-gray-500">Transfer and present receipt at front desk</div>
                        </div>
                        <span className="text-blue-600 font-bold text-sm">→</span>
                      </button>

                      <button onClick={() => selectPayment('already_paid')}
                        className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition text-center">
                        I have already paid in full
                      </button>
                    </div>
                  </>
                )}

                {fee === 0 && (
                  <button onClick={() => { sb.from('class_signins').update({ completed: true }).eq('id', signinId!); setStep('done') }}
                    className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-[15px] hover:bg-blue-700 transition">
                    Complete Sign-in
                  </button>
                )}
              </div>
            )}

            {/* ── STEP 4: Payment ── */}
            {step === 'payment'&& (
              <div>
                {form.payment_method === 'momo'&& (
                  <>
                    <h2 className="text-lg font-bold text-gray-900 mb-2">Pay with MoMo</h2>
                    <div className="bg-yellow-50 rounded-2xl p-4 mb-5 text-center">
                      <p className="text-3xl font-black text-yellow-700">GHS {fee.toFixed(2)}</p>
                    </div>
                    <button onClick={payWithPaystack}
                      className="w-full h-12 bg-yellow-500 text-white rounded-xl font-bold text-[15px] hover:bg-yellow-600 transition mb-3">
                      Pay GHS {fee.toFixed(2)} via MoMo
                    </button>
                    <button onClick={() => setStep('fee')} className="w-full text-xs text-gray-400 hover:text-gray-600 transition">← Change payment method</button>
                  </>
                )}

                {form.payment_method === 'cash'&& (
                  <>
                    <div className="text-center mb-5">
                      <div className="text-5xl mb-3"></div>
                      <h2 className="text-lg font-bold text-gray-900 mb-2">Please Visit the Front Desk</h2>
                      <p className="text-gray-500 text-sm">Please proceed to the front desk to make your cash payment of <strong>GHS {fee.toFixed(2)}</strong>.</p>
                      <div className="bg-orange-50 rounded-xl p-3 mt-4">
                        <p className="text-xs text-orange-700 font-semibold">Show this screen to the front desk staff</p>
                        <p className="text-xs text-orange-600 mt-1">Name: {form.full_name}</p>
                        <p className="text-xs text-orange-600">Course: {course?.name}</p>
                        <p className="text-xs text-orange-600">Amount: GHS {fee.toFixed(2)}</p>
                      </div>
                    </div>
                    <button onClick={confirmCashPayment}
                      className="w-full h-12 bg-green-600 text-white rounded-xl font-bold text-[15px] hover:bg-green-700 transition">
                      I've made my payment
                    </button>
                  </>
                )}

                {form.payment_method === 'bank'&& (
                  <>
                    <h2 className="text-lg font-bold text-gray-900 mb-2">Bank Transfer</h2>
                    <div className="bg-blue-50 rounded-2xl p-4 mb-5">
                      <p className="text-sm font-bold text-blue-900 mb-3">Bank Account Details</p>
                      <div className="space-y-2 text-sm text-blue-800">
                        <div className="flex justify-between"><span>Bank:</span><strong>GCB Bank</strong></div>
                        <div className="flex justify-between"><span>Account Name:</span><strong>Cambridge CE</strong></div>
                        <div className="flex justify-between"><span>Account No:</span><strong>1234567890</strong></div>
                        <div className="flex justify-between"><span>Amount:</span><strong>GHS {fee.toFixed(2)}</strong></div>
                        <div className="flex justify-between"><span>Reference:</span><strong>{form.full_name.split(' ')[0]}-CCE</strong></div>
                      </div>
                    </div>
                    <button onClick={confirmCashPayment}
                      className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-[15px] hover:bg-blue-700 transition">
                      I've made the transfer
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── STEP 5: Done ── */}
            {step === 'done'&& (
              <div className="text-center py-4">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
                  <svg width="40"height="40"viewBox="0 0 40 40"fill="none">
                    <path d="M8 20L16 28L32 12"stroke="#16a34a"strokeWidth="3"strokeLinecap="round"strokeLinejoin="round"/>
                  </svg>
                </div>
                <h2 className="text-2xl font-black text-gray-900 mb-2">Welcome! </h2>
                <p className="text-gray-600 mb-1">Hi <strong>{form.full_name.split(' ')[0]}</strong>,</p>
                <p className="text-gray-500 text-sm mb-2">You are signed in for today's class.</p>
                <p className="text-blue-600 font-bold text-sm mb-6">{course?.name}</p>
                <div className="bg-gray-50 rounded-2xl p-4">
                  <p className="text-sm text-gray-600">Thank you for being in class today.</p>
                  <p className="text-sm text-gray-600 mt-1 font-semibold">Have a productive session! </p>
                </div>
                <p className="text-xs text-gray-400 mt-5">Cambridge Centre of Excellence</p>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  )
}
