'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'

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
      if (i < 3) {
        setTimeout(() => refs[i + 1].current?.focus(), 0)
      } else {
        const full = next.join('')
        if (full.length === 4 && onFull && !busy.current) {
          setTimeout(() => onFull(full), 0)
        }
      }
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

  async function submitNewPin(confirmOverride?: string) {
    const np = newPin.join('')
    const cp = confirmOverride ?? confPin.join('')
    if (np.length < 4) { setError('Enter your new 4-digit PIN above first'); return }
    if (cp.length < 4) { setError('Confirm your PIN'); return }
    if (np !== cp) {
      setError("PINs don't match — try again")
      setConfPin(['', '', '', ''])
      setTimeout(() => c[0].current?.focus(), 80)
      return
    }
    setLoading(true); setError('')
    const res = await fetch('/api/auth/change-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPin: np }) })
    const d = await res.json()
    setLoading(false)
    if (d.success) router.replace('/admin')
    else setError(d.error || 'Failed')
  }

  const Boxes = ({ vals, setVals, refs, onFull }: { vals: string[], setVals: (a: string[]) => void, refs: typeof p, onFull?: (s: string) => void }) => (
    <div className="flex gap-3">
      {vals.map((v, i) => (
        <input key={i} ref={refs[i]}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric" maxLength={1} value={v} autoComplete="off"
          onChange={e => handleDigit(e.target.value, i, vals, setVals, refs, onFull)}
          onKeyDown={e => handleBksp(e, i, vals, setVals, refs)}
          className={`w-[58px] h-[64px] text-center text-2xl font-display font-semibold rounded-xl border transition-all duration-200 focus:outline-none caret-transparent
            ${v
              ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm'
              : 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'}`}
        />
      ))}
    </div>
  )


  return (
    <div className="min-h-screen w-screen flex" style={{ background: 'var(--paper)' }}>

      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between flex-1 relative overflow-hidden px-14 py-12"
        style={{ background: 'var(--accent)' }}>
        {/* soft texture rings */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
        <div className="absolute top-40 -right-10 w-64 h-64 rounded-full" style={{ background: 'rgba(255,255,255,0.03)' }} />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full" style={{ background: 'rgba(255,255,255,0.03)' }} />

        {/* top — mark */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
              <span className="font-display font-semibold text-white text-xl">C</span>
            </div>
            <div className="text-white/70 text-sm font-medium tracking-wide">Cambridge Centre of Excellence</div>
          </div>
        </div>

        {/* middle — statement */}
        <div className="relative max-w-md">
          <h1 className="font-display text-white text-[42px] leading-[1.1] font-semibold mb-5">
            Where every lead becomes a graduate.
          </h1>
          <p className="text-white/70 text-[15px] leading-relaxed">
            One place for your team to nurture leads, register students, track admissions and manage the work — built around how Cambridge actually runs.
          </p>
        </div>

        {/* bottom — quiet feature line */}
        <div className="relative flex items-center gap-8 text-white/60 text-[13px]">
          <span>CRM &amp; Pipeline</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>Admissions</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>Finance</span>
        </div>
      </div>

      {/* Right panel — login */}
      <div className="flex flex-col items-center justify-center flex-1 px-8" style={{ background: 'var(--canvas)' }}>
        <div className="w-full max-w-[360px]">

          {/* Mobile logo */}
          <div className="lg:hidden mb-10">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent)] flex items-center justify-center mb-4">
              <span className="font-display font-semibold text-white text-2xl">C</span>
            </div>
            <h1 className="font-display text-[var(--ink)] text-xl font-semibold">Cambridge Centre of Excellence</h1>
            <p className="text-[var(--ink-faint)] text-sm mt-1">Staff portal</p>
          </div>

          {step === 'pin' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)] mb-1.5">Welcome back</h2>
                <p className="text-[var(--ink-soft)] text-sm">Enter your 4-digit PIN to continue.</p>
              </div>

              <Boxes vals={pin} setVals={setPin} refs={p} onFull={submitPin} />

              <div className="mt-4">
                <button onClick={() => setShowPin(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)] hover:text-[var(--ink-soft)] transition-colors">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showPin ? 'Hide PIN' : 'Show PIN'}
                </button>
              </div>

              {loading && (
                <div className="flex items-center gap-2 mt-6 text-[var(--ink-soft)]">
                  <span className="w-4 h-4 border-2 border-[var(--ink-faint)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Verifying…</span>
                </div>
              )}

              {error && !loading && (
                <div className="mt-6 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <p className="text-xs text-[var(--ink-faint)] mt-8">
                Forgot your PIN? Contact your administrator.
              </p>
            </>
          )}

          {step === 'set-pin' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[26px] leading-tight font-semibold text-[var(--ink)] mb-1.5">Set your PIN</h2>
                <p className="text-[var(--ink-soft)] text-sm">First time here — choose a 4-digit PIN only you know.</p>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3">New PIN</p>
                  <Boxes vals={newPin} setVals={setNewPin} refs={n} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3">Confirm PIN</p>
                  <Boxes vals={confPin} setVals={setConfPin} refs={c} onFull={(full) => submitNewPin(full)} />
                </div>
              </div>

              <div className="mt-4">
                <button onClick={() => setShowPin(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)] hover:text-[var(--ink-soft)] transition-colors">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showPin ? 'Hide' : 'Show'}
                </button>
              </div>

              {error && (
                <div className="mt-5 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                  {error}
                </div>
              )}

              <button onClick={() => submitNewPin()} disabled={loading || newPin.join('').length < 4}
                className="w-full h-12 bg-[var(--accent)] text-white rounded-xl font-medium text-sm mt-6 hover:brightness-110 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Setting PIN…</>
                  : 'Set PIN and continue'}
              </button>
            </>
          )}

          <p className="text-[11px] text-[var(--ink-faint)] mt-12">
            Cambridge Centre of Excellence · {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-screen flex items-center justify-center" style={{ background: 'var(--canvas)' }}><div className="w-6 h-6 border-2 border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  )
}
