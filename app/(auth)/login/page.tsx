'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Eye, EyeOff, Shield } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const [step,    setStep]    = useState<'pin' | 'set-pin'>('pin')
  const [pin,     setPin]     = useState(['', '', '', ''])
  const [newPin,  setNewPin]  = useState(['', '', '', ''])
  const [confPin, setConfPin] = useState(['', '', '', ''])
  const [showPin, setShowPin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const submitting = useRef(false)

  const p = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const n = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const c = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  useEffect(() => {
    setTimeout(() => p[0].current?.focus(), 100)
  }, [])

  function handleDigit(
    val: string, i: number,
    arr: string[], set: (a: string[]) => void,
    refs: typeof p,
    onFull?: (s: string) => void
  ) {
    if (!/^\d*$/.test(val)) return
    const ch = val.slice(-1)
    const next = [...arr]
    next[i] = ch
    set(next)
    if (ch) {
      if (i < 3) {
        refs[i + 1].current?.focus()
      } else {
        const full = next.join('')
        if (full.length === 4 && onFull && !submitting.current) {
          onFull(full)
        }
      }
    }
  }

  function handleBksp(e: React.KeyboardEvent, i: number, arr: string[], set: (a:string[])=>void, refs: typeof p) {
    if (e.key === 'Backspace') {
      const next = [...arr]
      if (next[i]) { next[i] = ''; set(next) }
      else if (i > 0) { next[i - 1] = ''; set(next); refs[i - 1].current?.focus() }
    }
  }

  async function submitPin(pinStr: string) {
    submitting.current = true
    setLoading(true); setError('')
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinStr }),
    })
    const d = await res.json()
    submitting.current = false
    setLoading(false)
    if (!d.success) {
      setError(d.error || 'Incorrect PIN')
      setPin(['', '', '', ''])
      setTimeout(() => p[0].current?.focus(), 80)
      return
    }
    if (d.mustChangePIN) {
      setStep('set-pin')
      setTimeout(() => n[0].current?.focus(), 100)
      return
    }
    router.replace(d.redirect || '/admin')
  }

  async function submitNewPin() {
    const np = newPin.join(''), cp = confPin.join('')
    if (np.length < 4) { setError('Enter 4 digits'); return }
    if (np !== cp) {
      setError("PINs don't match")
      setConfPin(['', '', '', ''])
      setTimeout(() => c[0].current?.focus(), 80)
      return
    }
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

  const Boxes = ({ vals, setVals, refs, onFull }: {
    vals: string[], setVals: (a:string[])=>void, refs: typeof p, onFull?: (s:string)=>void
  }) => (
    <div className="flex gap-4 justify-center">
      {vals.map((v, i) => (
        <input key={i} ref={refs[i]}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric" maxLength={1} value={v} autoComplete="off"
          onChange={e => handleDigit(e.target.value, i, vals, setVals, refs, onFull)}
          onKeyDown={e => handleBksp(e, i, vals, setVals, refs)}
          className={`
            w-16 h-16 text-center text-2xl font-black rounded-2xl border-2
            transition-all duration-100 focus:outline-none caret-transparent
            ${v
              ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-500/40'
              : 'border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white focus:shadow-md'}
          `}
        />
      ))}
    </div>
  )

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-600/40">
          <Building2 size={28} className="text-white" />
        </div>
        <h1 className="text-white text-xl font-black">Cambridge Centre<br />of Excellence</h1>
        <p className="text-blue-300/60 text-sm mt-1">Staff Portal</p>
      </div>

      <div className="bg-white rounded-3xl shadow-2xl shadow-black/30 overflow-hidden">

        {/* ── PIN entry ── */}
        {step === 'pin' && (
          <div className="p-8">
            <h2 className="text-xl font-black text-gray-900 text-center mb-1">Enter your PIN</h2>
            <p className="text-gray-400 text-sm text-center mb-8">Your 4-digit security PIN</p>
            <Boxes vals={pin} setVals={setPin} refs={p} onFull={submitPin} />
            <button onClick={() => setShowPin(s => !s)}
              className="flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-gray-500 mx-auto mt-5 transition-colors">
              {showPin ? <EyeOff size={12} /> : <Eye size={12} />}
              {showPin ? 'Hide' : 'Show'} PIN
            </button>
            {loading && (
              <div className="flex items-center justify-center gap-2 mt-5 text-blue-600">
                <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium">Verifying…</span>
              </div>
            )}
            {error && !loading && (
              <div className="mt-5 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-2.5 text-center">
                {error}
              </div>
            )}
            <p className="text-center text-xs text-gray-300 mt-6">
              Forgot your PIN? Contact your administrator
            </p>
          </div>
        )}

        {/* ── Set new PIN (first login) ── */}
        {step === 'set-pin' && (
          <div className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                <Shield size={18} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-gray-900">Set your personal PIN</h2>
                <p className="text-xs text-gray-400">Choose a PIN only you will know</p>
              </div>
            </div>
            <div className="space-y-6">
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide text-center mb-3">New PIN</p>
                <Boxes vals={newPin} setVals={setNewPin} refs={n} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide text-center mb-3">Confirm PIN</p>
                <Boxes vals={confPin} setVals={setConfPin} refs={c} onFull={() => submitNewPin()} />
              </div>
            </div>
            <button onClick={() => setShowPin(s => !s)}
              className="flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-gray-500 mx-auto mt-4 transition-colors">
              {showPin ? <EyeOff size={12} /> : <Eye size={12} />}
              {showPin ? 'Hide' : 'Show'}
            </button>
            {error && (
              <div className="mt-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-2.5 text-center">
                {error}
              </div>
            )}
            <button onClick={submitNewPin} disabled={loading || newPin.join('').length < 4}
              className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-[15px] mt-6 hover:bg-green-700 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
              {loading
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Setting…</>
                : <><Shield size={16} /> Set PIN & Enter</>}
            </button>
          </div>
        )}
      </div>

      <p className="text-center text-blue-400/30 text-[10px] mt-6">
        © {new Date().getFullYear()} Cambridge Centre of Excellence
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen w-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
