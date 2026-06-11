'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Eye, EyeOff, Shield, Phone, ArrowLeft } from 'lucide-react'

function LoginForm() {
  const router = useRouter()

  const [step,      setStep]    = useState<'phone'|'pin'|'set-pin'>('phone')
  const [phone,     setPhone]   = useState('')
  const [pin,       setPin]     = useState(['','','',''])
  const [newPin,    setNewPin]  = useState(['','','',''])
  const [confPin,   setConfPin] = useState(['','','',''])
  const [showPin,   setShowPin] = useState(false)
  const [loading,   setLoading] = useState(false)
  const [error,     setError]   = useState('')
  const submitRef = useRef(false)  // prevent double-submit

  const phoneRef = useRef<HTMLInputElement>(null)
  const pr = [useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null)]
  const nr = [useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null)]
  const cr = [useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null)]

  useEffect(() => { phoneRef.current?.focus() }, [])

  function handlePhone(e: React.FormEvent) {
    e.preventDefault()
    const raw = phone.trim().replace(/\s+/g,'')
    if (!raw || raw.length < 9) { setError('Enter a valid phone number'); return }
    setError('')
    setStep('pin')
    setTimeout(() => pr[0].current?.focus(), 80)
  }

  function handlePinDigit(val: string, i: number, arr: string[], setArr: (a:string[])=>void, refs: any[], onComplete?: (full:string)=>void) {
    if (!/^\d*$/.test(val)) return
    const ch = val.slice(-1)
    const next = [...arr]
    next[i] = ch
    setArr(next)

    if (ch) {
      if (i < 3) {
        refs[i+1].current?.focus()
      } else if (onComplete) {
        // All 4 filled
        const full = next.join('')
        if (full.length === 4 && !submitRef.current) {
          onComplete(full)
        }
      }
    }
  }

  function handleBksp(e: React.KeyboardEvent, i: number, arr: string[], setArr: (a:string[])=>void, refs: any[]) {
    if (e.key === 'Backspace') {
      if (arr[i]) {
        const next = [...arr]; next[i] = ''; setArr(next)
      } else if (i > 0) {
        refs[i-1].current?.focus()
        const next = [...arr]; next[i-1] = ''; setArr(next)
      }
    }
  }

  async function submitPin(pinStr: string) {
    if (submitRef.current) return
    submitRef.current = true
    setLoading(true); setError('')

    const res = await fetch('/api/auth/verify-pin', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ phone: phone.trim(), pin: pinStr }),
    })
    const d = await res.json()
    submitRef.current = false
    setLoading(false)

    if (!d.success) {
      setError(d.error || 'Wrong PIN')
      setPin(['','','',''])
      setTimeout(() => pr[0].current?.focus(), 80)
      return
    }
    if (d.mustChangePIN) {
      setStep('set-pin')
      setTimeout(() => nr[0].current?.focus(), 100)
      return
    }
    router.replace(d.redirect || '/admin')
  }

  async function submitNewPin() {
    const np = newPin.join(''), cp = confPin.join('')
    if (np.length < 4) { setError('Enter 4 digits'); return }
    if (np !== cp) {
      setError("PINs don't match")
      setConfPin(['','','',''])
      setTimeout(() => cr[0].current?.focus(), 80)
      return
    }
    setLoading(true); setError('')
    const res = await fetch('/api/auth/change-pin', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ newPin: np }),
    })
    const d = await res.json()
    setLoading(false)
    if (d.success) router.replace('/admin')
    else setError(d.error || 'Failed')
  }

  /* ── 4 PIN boxes ─────────────────────────────────────────── */
  const PinBoxes = ({
    vals, setVals, refs, onComplete,
  }: { vals:string[], setVals:(a:string[])=>void, refs:any[], onComplete?:(s:string)=>void }) => (
    <div className="flex gap-3 justify-center">
      {vals.map((v, i) => (
        <input
          key={i}
          ref={refs[i]}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric"
          maxLength={1}
          value={v}
          autoComplete="off"
          onChange={e => handlePinDigit(e.target.value, i, vals, setVals, refs, onComplete)}
          onKeyDown={e => handleBksp(e, i, vals, setVals, refs)}
          className={`
            w-16 h-16 text-center text-2xl font-black rounded-2xl border-2
            transition-all duration-100 focus:outline-none caret-transparent
            ${v ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-500/40'
               : 'border-gray-200 bg-gray-50 text-gray-900 focus:border-blue-400 focus:bg-white focus:shadow-md'}
          `}
        />
      ))}
    </div>
  )

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-600/40">
          <Building2 size={28} className="text-white" />
        </div>
        <h1 className="text-white text-xl font-black tracking-tight">Cambridge Centre<br/>of Excellence</h1>
        <p className="text-blue-300/60 text-sm mt-1.5">Staff Portal</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-3xl shadow-2xl shadow-black/30 overflow-hidden">

        {/* Step 1 — Phone */}
        {step === 'phone' && (
          <div className="p-7">
            <h2 className="text-xl font-black text-gray-900 mb-1">Welcome back 👋</h2>
            <p className="text-gray-400 text-sm mb-6">Enter your phone number to continue</p>
            <form onSubmit={handlePhone}>
              <div className="relative mb-4">
                <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={phoneRef}
                  type="tel" inputMode="numeric"
                  value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="024 000 0000"
                  className="w-full h-14 pl-11 pr-4 rounded-2xl border-2 border-gray-200 text-[15px] font-medium focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all"
                />
              </div>
              {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-2.5 mb-4">{error}</div>}
              <button type="submit"
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-[15px] hover:bg-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-500/30">
                Continue →
              </button>
            </form>
            <p className="text-center text-xs text-gray-300 mt-5">Forgot your PIN? Contact your administrator</p>
          </div>
        )}

        {/* Step 2 — PIN */}
        {step === 'pin' && (
          <div className="p-7">
            <button onClick={() => { setStep('phone'); setPin(['','','','']); setError('') }}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 mb-5 transition-colors">
              <ArrowLeft size={13} />
              <span className="font-semibold">{phone}</span>
            </button>

            <h2 className="text-xl font-black text-gray-900 mb-1 text-center">Enter your PIN</h2>
            <p className="text-gray-400 text-sm mb-7 text-center">Your 4-digit security PIN</p>

            <PinBoxes vals={pin} setVals={setPin} refs={pr} onComplete={submitPin} />

            <button onClick={() => setShowPin(s => !s)}
              className="flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-gray-500 mx-auto mt-4 transition-colors">
              {showPin ? <EyeOff size={12}/> : <Eye size={12}/>}
              {showPin ? 'Hide PIN' : 'Show PIN'}
            </button>

            {loading && (
              <div className="flex items-center justify-center gap-2 mt-5 text-blue-600">
                <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Verifying…</span>
              </div>
            )}
            {error && !loading && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-2.5 mt-5 text-center">{error}</div>
            )}
            <p className="text-center text-[11px] text-gray-300 mt-6">Forgot your PIN? Contact your administrator</p>
          </div>
        )}

        {/* Step 3 — Set new PIN (first login) */}
        {step === 'set-pin' && (
          <div className="p-7">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                <Shield size={18} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-gray-900">Set your personal PIN</h2>
                <p className="text-xs text-gray-400">First login — choose a PIN only you know</p>
              </div>
            </div>
            <div className="space-y-6">
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide text-center mb-3">New PIN</p>
                <PinBoxes vals={newPin} setVals={setNewPin} refs={nr} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide text-center mb-3">Confirm PIN</p>
                <PinBoxes vals={confPin} setVals={setConfPin} refs={cr} onComplete={() => submitNewPin()} />
              </div>
            </div>
            <button onClick={() => setShowPin(s => !s)}
              className="flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-gray-500 mx-auto mt-3 transition-colors">
              {showPin ? <EyeOff size={12}/> : <Eye size={12}/>}
              {showPin ? 'Hide' : 'Show'}
            </button>
            {error && <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-2.5 mt-4 text-center">{error}</div>}
            <button onClick={submitNewPin} disabled={loading || newPin.join('').length < 4}
              className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-[15px] mt-6 hover:bg-green-700 disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              {loading
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Setting…</>
                : <><Shield size={16}/>Set PIN & Enter</>}
            </button>
          </div>
        )}
      </div>
      <p className="text-center text-blue-400/30 text-[10px] mt-6">© {new Date().getFullYear()} Cambridge Centre of Excellence</p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen w-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
      </div>
    }>
      <LoginForm/>
    </Suspense>
  )
}
