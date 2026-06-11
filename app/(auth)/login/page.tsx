'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Shield } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const [step,    setStep]    = useState<'pin' | 'set-pin'>('pin')
  const [pin,     setPin]     = useState(['', '', '', ''])
  const [newPin,  setNewPin]  = useState(['', '', '', ''])
  const [confPin, setConfPin] = useState(['', '', '', ''])
  const [showPin, setShowPin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const busy = useRef(false)

  const p = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const n = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const c = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  useEffect(() => { setTimeout(() => p[0].current?.focus(), 120) }, [])

  function handleDigit(val: string, i: number, arr: string[], set: (a: string[]) => void, refs: typeof p, onFull?: (s: string) => void) {
    if (!/^\d*$/.test(val)) return
    const ch = val.slice(-1)
    const next = [...arr]; next[i] = ch; set(next)
    if (ch) {
      if (i < 3) refs[i + 1].current?.focus()
      else { const full = next.join(''); if (full.length === 4 && onFull && !busy.current) onFull(full) }
    }
  }

  function handleBksp(e: React.KeyboardEvent, i: number, arr: string[], set: (a: string[]) => void, refs: typeof p) {
    if (e.key !== 'Backspace') return
    const next = [...arr]
    if (next[i]) { next[i] = ''; set(next) }
    else if (i > 0) { next[i - 1] = ''; set(next); refs[i - 1].current?.focus() }
  }

  async function submitPin(pinStr: string) {
    busy.current = true; setLoading(true); setError('')
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinStr }),
    })
    const d = await res.json()
    busy.current = false; setLoading(false)
    if (!d.success) {
      setError(d.error || 'Incorrect PIN')
      setPin(['', '', '', ''])
      setTimeout(() => p[0].current?.focus(), 80)
      return
    }
    if (d.mustChangePIN) { setStep('set-pin'); setTimeout(() => n[0].current?.focus(), 100); return }
    router.replace(d.redirect || '/admin')
  }

  async function submitNewPin() {
    const np = newPin.join(''), cp = confPin.join('')
    if (np.length < 4) { setError('Enter 4 digits'); return }
    if (np !== cp) { setError("PINs don't match"); setConfPin(['', '', '', '']); setTimeout(() => c[0].current?.focus(), 80); return }
    setLoading(true); setError('')
    const res = await fetch('/api/auth/change-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPin: np }) })
    const d = await res.json()
    setLoading(false)
    if (d.success) router.replace('/admin')
    else setError(d.error || 'Failed')
  }

  const Boxes = ({ vals, setVals, refs, onFull }: { vals: string[], setVals: (a: string[]) => void, refs: typeof p, onFull?: (s: string) => void }) => (
    <div className="flex gap-3 justify-center">
      {vals.map((v, i) => (
        <input key={i} ref={refs[i]}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric" maxLength={1} value={v} autoComplete="off"
          onChange={e => handleDigit(e.target.value, i, vals, setVals, refs, onFull)}
          onKeyDown={e => handleBksp(e, i, vals, setVals, refs)}
          className={`w-14 h-14 text-center text-xl font-bold rounded-xl border-2 transition-all focus:outline-none caret-transparent
            ${v ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-900 focus:border-blue-500'}`}
        />
      ))}
    </div>
  )

  return (
    <div className="min-h-screen w-screen bg-white flex">

      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col items-center justify-center flex-1 bg-gray-950 px-12">
        <div className="max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-6">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
            </svg>
          </div>
          <h1 className="text-white text-3xl font-black mb-3 leading-tight">Cambridge Centre of Excellence</h1>
          <p className="text-gray-400 text-base leading-relaxed">Enterprise Resource Planning System for managing leads, admissions, finance and operations.</p>
          <div className="mt-10 grid grid-cols-3 gap-4 text-center">
            {[['CRM', 'Lead management'], ['Finance', 'Payments'], ['Admissions', 'Student flow']].map(([t, s]) => (
              <div key={t} className="bg-white/5 rounded-xl p-3">
                <div className="text-white text-sm font-bold">{t}</div>
                <div className="text-gray-500 text-xs mt-0.5">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — login */}
      <div className="flex flex-col items-center justify-center flex-1 px-8 bg-white">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
              </svg>
            </div>
            <h1 className="text-gray-900 text-xl font-black">Cambridge Centre of Excellence</h1>
            <p className="text-gray-400 text-sm mt-1">Staff Portal</p>
          </div>

          {step === 'pin' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-black text-gray-900 mb-1">Enter your PIN</h2>
                <p className="text-gray-400 text-sm">Type your 4-digit security PIN to continue</p>
              </div>

              <Boxes vals={pin} setVals={setPin} refs={p} onFull={submitPin} />

              <div className="flex justify-center mt-4">
                <button onClick={() => setShowPin(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showPin ? 'Hide PIN' : 'Show PIN'}
                </button>
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-2 mt-6 text-gray-500">
                  <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Verifying</span>
                </div>
              )}

              {error && !loading && (
                <div className="mt-6 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 text-center">
                  {error}
                </div>
              )}

              <p className="text-center text-xs text-gray-300 mt-8">
                Forgot your PIN? Contact your administrator
              </p>
            </>
          )}

          {step === 'set-pin' && (
            <>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Shield size={18} className="text-green-600" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-gray-900">Set your personal PIN</h2>
                  <p className="text-sm text-gray-400">First login — choose a PIN only you know</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 text-center">New PIN</p>
                  <Boxes vals={newPin} setVals={setNewPin} refs={n} />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 text-center">Confirm PIN</p>
                  <Boxes vals={confPin} setVals={setConfPin} refs={c} onFull={() => submitNewPin()} />
                </div>
              </div>

              <div className="flex justify-center mt-4">
                <button onClick={() => setShowPin(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showPin ? 'Hide' : 'Show'}
                </button>
              </div>

              {error && (
                <div className="mt-5 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 text-center">
                  {error}
                </div>
              )}

              <button onClick={submitNewPin} disabled={loading || newPin.join('').length < 4}
                className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold text-sm mt-6 hover:bg-blue-700 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Setting PIN</>
                  : <><Shield size={15} /> Set PIN and Enter</>}
              </button>
            </>
          )}

          <p className="text-center text-xs text-gray-200 mt-10">
            Cambridge Centre of Excellence — {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-screen bg-white flex items-center justify-center"><div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  )
}
