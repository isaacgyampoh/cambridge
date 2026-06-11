'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, Eye, EyeOff, Shield, ArrowLeft } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState(['', '', '', ''])
  const [showPin, setShowPin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'email' | 'pin' | 'set-pin'>('email')
  const [newPin, setNewPin] = useState(['', '', '', ''])
  const [confirmPin, setConfirmPin] = useState(['', '', '', ''])
  const emailRef = useRef<HTMLInputElement>(null)

  const p0=useRef<HTMLInputElement>(null), p1=useRef<HTMLInputElement>(null),
        p2=useRef<HTMLInputElement>(null), p3=useRef<HTMLInputElement>(null)
  const pinRefs = [p0, p1, p2, p3]

  const n0=useRef<HTMLInputElement>(null), n1=useRef<HTMLInputElement>(null),
        n2=useRef<HTMLInputElement>(null), n3=useRef<HTMLInputElement>(null)
  const newRefs = [n0, n1, n2, n3]

  const c0=useRef<HTMLInputElement>(null), c1=useRef<HTMLInputElement>(null),
        c2=useRef<HTMLInputElement>(null), c3=useRef<HTMLInputElement>(null)
  const confRefs = [c0, c1, c2, c3]

  useEffect(() => { emailRef.current?.focus() }, [])

  function handleDigit(val: string, i: number, arr: string[], setArr: (a:string[])=>void, refs: any[]) {
    if (!/^\d*$/.test(val)) return
    const next = [...arr]; next[i] = val.slice(-1); setArr(next)
    if (val && i < 3) refs[i+1].current?.focus()
  }

  function handleBksp(e: React.KeyboardEvent, i: number, arr: string[], refs: any[]) {
    if (e.key === 'Backspace' && !arr[i] && i > 0) refs[i-1].current?.focus()
  }

  // Auto-submit PIN when all 4 digits entered
  useEffect(() => {
    if (step === 'pin' && pin.join('').length === 4) {
      submitPin(pin.join(''))
    }
  }, [pin])

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Enter your email'); return }
    setError('')
    setStep('pin')
    setTimeout(() => pinRefs[0].current?.focus(), 150)
  }

  async function submitPin(pinStr: string) {
    setLoading(true); setError('')
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), pin: pinStr }),
    })
    const data = await res.json()
    setLoading(false)

    if (!data.success) {
      setError(data.error || 'Incorrect PIN')
      setPin(['','','',''])
      setTimeout(() => pinRefs[0].current?.focus(), 100)
      return
    }

    if (data.mustChangePIN) {
      setStep('set-pin')
      setTimeout(() => newRefs[0].current?.focus(), 150)
      return
    }

    router.replace(data.redirect || '/admin')
  }

  async function submitNewPin() {
    const np = newPin.join(''), cp = confirmPin.join('')
    if (np.length < 4) { setError('Enter 4 digits'); return }
    if (np !== cp) { setError("PINs don't match"); setConfirmPin(['','','','']); setTimeout(() => confRefs[0].current?.focus(), 100); return }
    setLoading(true); setError('')
    const res = await fetch('/api/auth/change-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: np }),
    })
    const d = await res.json()
    setLoading(false)
    if (d.success) router.replace('/admin')
    else setError(d.error || 'Failed')
  }

  const PinBoxes = ({ val, set, refs, onDone }: { val: string[], set: (a:string[])=>void, refs: any[], onDone?: ()=>void }) => (
    <div className="flex gap-3 justify-center">
      {val.map((digit, i) => (
        <input key={i} ref={refs[i]}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric" maxLength={1} value={digit}
          onChange={e => { handleDigit(e.target.value, i, val, set, refs); if (e.target.value && i === 3 && onDone) onDone() }}
          onKeyDown={e => handleBksp(e, i, val, refs)}
          className={`w-14 h-16 text-center text-2xl font-black rounded-2xl border-2 focus:outline-none transition-all select-none
            ${digit ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-900'}
            focus:border-blue-500 focus:bg-white focus:shadow-md`}
        />
      ))}
    </div>
  )

  return (
    <div className="w-full max-w-xs fade-in">
      {/* Logo */}
      <div className="text-center mb-7">
        <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-blue-600/30">
          <Building2 size={26} className="text-white" />
        </div>
        <h1 className="text-white font-bold text-lg leading-tight">Cambridge Centre<br/>of Excellence</h1>
        <p className="text-blue-300/70 text-xs mt-1">Staff Portal</p>
      </div>

      <div className="bg-white rounded-3xl p-7 shadow-2xl shadow-black/20">

        {/* Email step */}
        {step === 'email' && (
          <>
            <h2 className="text-base font-bold text-gray-900 mb-0.5">Welcome back</h2>
            <p className="text-gray-400 text-xs mb-5">Enter your email to continue</p>
            <form onSubmit={submitEmail}>
              <input ref={emailRef} type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@cambridge.edu.gh"
                className="w-full h-12 px-4 rounded-xl border-2 border-gray-200 text-sm focus:outline-none focus:border-blue-500 transition mb-4" />
              {error && <p className="text-red-500 text-xs mb-3 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
              <button type="submit"
                className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 active:scale-[0.98] transition-all">
                Continue →
              </button>
            </form>
          </>
        )}

        {/* PIN step */}
        {step === 'pin' && (
          <>
            <button onClick={() => { setStep('email'); setPin(['','','','']); setError('') }}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 mb-4 transition-colors">
              <ArrowLeft size={13} /> {email}
            </button>
            <h2 className="text-base font-bold text-gray-900 mb-0.5 text-center">Enter your PIN</h2>
            <p className="text-gray-400 text-xs mb-6 text-center">Your 4-digit security PIN</p>

            <PinBoxes val={pin} set={setPin} refs={pinRefs} />

            <button onClick={() => setShowPin(!showPin)}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 mx-auto mt-3 transition-colors">
              {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
              {showPin ? 'Hide' : 'Show'}
            </button>

            {error && <p className="text-red-500 text-xs mt-4 bg-red-50 rounded-xl px-3 py-2 text-center">{error}</p>}

            {loading && (
              <div className="flex items-center justify-center gap-2 mt-4 text-blue-600">
                <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs">Verifying...</span>
              </div>
            )}

            <p className="text-center text-[11px] text-gray-300 mt-5">
              Forgot your PIN? Contact your administrator
            </p>
          </>
        )}

        {/* Set PIN step (first login) */}
        {step === 'set-pin' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                <Shield size={16} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Set your personal PIN</h2>
                <p className="text-[11px] text-gray-400">First login — choose your 4-digit PIN</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-[11px] text-gray-500 mb-2 text-center">New PIN</p>
                <PinBoxes val={newPin} set={setNewPin} refs={newRefs} />
              </div>
              <div>
                <p className="text-[11px] text-gray-500 mb-2 text-center">Confirm PIN</p>
                <PinBoxes val={confirmPin} set={setConfirmPin} refs={confRefs} />
              </div>
            </div>

            <button onClick={() => setShowPin(!showPin)}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 mx-auto mt-3 transition-colors">
              {showPin ? <EyeOff size={11} /> : <Eye size={11} />}
              {showPin ? 'Hide' : 'Show'}
            </button>

            {error && <p className="text-red-500 text-xs mt-3 bg-red-50 rounded-xl px-3 py-2 text-center">{error}</p>}

            <button onClick={submitNewPin} disabled={loading || newPin.join('').length < 4}
              className="w-full h-12 bg-green-600 text-white rounded-xl font-bold text-sm mt-5 hover:bg-green-700 disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              {loading
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Setting PIN...</>
                : <><Shield size={15} /> Set PIN & Enter</>}
            </button>
          </>
        )}
      </div>

      <p className="text-center text-blue-400/30 text-[10px] mt-5">
        © {new Date().getFullYear()} Cambridge Centre of Excellence
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  )
}
