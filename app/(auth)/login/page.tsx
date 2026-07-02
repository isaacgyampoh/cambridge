'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const [step,    setStep]    = useState<'pin' | 'otp' | 'set-pin'>('pin')
  const [pin,     setPin]     = useState(['', '', '', ''])
  const [otp,     setOtp]     = useState(['', '', '', ''])
  const [otpUserId, setOtpUserId] = useState('')
  const [emailHint, setEmailHint] = useState('')
  const [pendingChangePin, setPendingChangePin] = useState(false)
  const [newPin,  setNewPin]  = useState(['', '', '', ''])
  const [confPin, setConfPin] = useState(['', '', '', ''])
  const [showPin, setShowPin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const busy = useRef(false)

  const p = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const n = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const c = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const o = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  useEffect(() => { setTimeout(() => p[0].current?.focus(), 120) }, [])

  function handleDigit(val: string, i: number, arr: string[], set: React.Dispatch<React.SetStateAction<string[]>>, refs: typeof p, onFull?: (s: string) => void) {
    if (!/^\d*$/.test(val)) return
    const ch = val.slice(-1)
    // Compute the next array from the CURRENT props (arr is the live value
    // for this box passed from render), update state, THEN do side effects
    // (focus / submit) outside the updater so they always run exactly once.
    const next = [...arr]
    next[i] = ch
    set(next)
    if (!ch) return
    if (i < 3) {
      refs[i + 1].current?.focus()
    } else {
      const full = next.join('')
      if (full.length === 4 && onFull && !busy.current) {
        onFull(full)
      }
    }
  }

  function handleBksp(e: React.KeyboardEvent, i: number, arr: string[], set: React.Dispatch<React.SetStateAction<string[]>>, refs: typeof p) {
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
    // PIN correct → an OTP was emailed. Move to the OTP step.
    if (d.otpRequired) {
      setOtpUserId(d.userId)
      setEmailHint(d.emailHint || '')
      setPendingChangePin(!!d.mustChangePIN)
      setStep('otp')
      setTimeout(() => o[0].current?.focus(), 120)
      return
    }
    if (d.mustChangePIN) { setStep('set-pin'); setTimeout(() => n[0].current?.focus(), 100); return }
    router.replace(d.redirect || '/admin')
  }

  async function submitOtp(codeStr: string) {
    busy.current = true; setLoading(true); setError('')
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: otpUserId, code: codeStr }),
    })
    const d = await res.json()
    busy.current = false; setLoading(false)
    if (!d.success) {
      setError(d.error || 'Incorrect code')
      setOtp(['', '', '', ''])
      setTimeout(() => o[0].current?.focus(), 80)
      return
    }
    if (d.mustChangePIN || pendingChangePin) { setStep('set-pin'); setTimeout(() => n[0].current?.focus(), 100); return }
    router.replace(d.redirect || '/admin')
  }

  async function resendOtp() {
    // Re-run the PIN step silently using the stored PIN isn't possible (we don't keep it),
    // so ask the user to re-enter the PIN.
    setError(''); setOtp(['', '', '', '']); setStep('pin'); setPin(['', '', '', ''])
    setTimeout(() => p[0].current?.focus(), 100)
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

  // NOTE: this is a plain render function, NOT a nested component. Rendering
  // it as <Boxes/> would make React remount the inputs on every keystroke
  // (losing focus and dropping fast input). Calling renderBoxes(...) inlines
  // the elements so the inputs stay mounted and auto-advance works.
  const renderBoxes = (vals: string[], setVals: React.Dispatch<React.SetStateAction<string[]>>, refs: typeof p, onFull?: (s: string) => void) => (
    <div className="flex gap-3 justify-center lg:justify-start">
      {vals.map((v, i) => (
        <input key={i} ref={refs[i]}
          type={showPin ? 'text' : 'password'}
          inputMode="numeric" maxLength={1} value={v} autoComplete="off"
          onChange={e => handleDigit(e.target.value, i, vals, setVals, refs, onFull)}
          onKeyDown={e => handleBksp(e, i, vals, setVals, refs)}
          style={{
            backgroundColor: v ? 'var(--accent)' : 'var(--paper)',
            borderColor: v ? 'var(--accent)' : 'var(--line)',
            color: v ? '#fff' : 'var(--ink)',
            transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
          }}
          className="w-[58px] h-[64px] text-center text-2xl font-display font-semibold rounded-xl border-2 focus:outline-none focus:border-[var(--accent)] caret-transparent"
        />
      ))}
    </div>
  )


  return (
    <div className="min-h-screen w-screen flex" style={{ background: 'var(--paper)' }}>

      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between flex-1 relative overflow-hidden px-14 py-12"
        style={{ background: 'linear-gradient(155deg, #14636c 0%, #1a7a85 55%, #17707a 100%)' }}>
        {/* depth: soft radial glow */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 85% 0%, rgba(255,255,255,0.10), transparent 60%)' }} />
        <div className="absolute -bottom-32 -left-24 w-[420px] h-[420px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.05), transparent 70%)' }} />

        {/* top — mark */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center overflow-hidden p-1 shadow-lg">
              <img src="/brand/logo.png" alt="Cambridge Centre of Excellence" className="w-full h-full object-contain" />
            </div>
            <div className="text-white text-[15px] font-semibold tracking-tight">Cambridge Centre of Excellence</div>
          </div>
        </div>

        {/* middle — statement */}
        <div className="relative max-w-md">
          <div className="text-white/50 text-[13px] font-medium mb-4 tracking-wide uppercase">Staff portal</div>
          <h1 className="font-display text-white text-[44px] leading-[1.08] font-semibold mb-5 tracking-[-0.02em]">
            Where every lead becomes a graduate.
          </h1>
          <p className="text-white/65 text-[15px] leading-relaxed">
            One place for your team to nurture leads, register students, track admissions and manage the work — built around how Cambridge actually runs.
          </p>
        </div>

        {/* bottom — quiet feature line */}
        <div className="relative flex items-center gap-5 text-white/55 text-[13px] font-medium">
          <span>CRM &amp; pipeline</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>Admissions</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>Finance</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>Messaging</span>
        </div>
      </div>

      {/* Right panel — login */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-10" style={{ background: 'var(--canvas)' }}>
        <div className="w-full max-w-[360px] text-center lg:text-left">

          {/* Mobile logo */}
          <div className="lg:hidden mb-10 flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-white border border-[var(--line)] flex items-center justify-center mb-4 overflow-hidden p-1">
              <img src="/brand/logo.png" alt="Cambridge Centre of Excellence" className="w-full h-full object-contain" />
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

              {renderBoxes(pin, setPin, p, submitPin)}

              <div className="mt-4 flex justify-center lg:justify-start">
                <button onClick={() => setShowPin(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)] hover:text-[var(--ink-soft)] transition-colors">
                  {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showPin ? 'Hide PIN' : 'Show PIN'}
                </button>
              </div>

              {loading && (
                <div className="flex items-center justify-center lg:justify-start gap-2 mt-6 text-[var(--ink-soft)]">
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

          {step === 'otp' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[26px] leading-tight font-semibold text-[var(--ink)] mb-1.5">Check your email</h2>
                <p className="text-[var(--ink-soft)] text-sm">We sent a 4-digit code to {emailHint || 'your email'}. Enter it below to finish signing in.</p>
              </div>

              <div className="flex gap-3 justify-center lg:justify-start">
                {otp.map((v, i) => (
                  <input key={i} ref={o[i]}
                    type="text" inputMode="numeric" maxLength={1} value={v} autoComplete="off"
                    onChange={e => handleDigit(e.target.value, i, otp, setOtp, o, submitOtp)}
                    onKeyDown={e => handleBksp(e, i, otp, setOtp, o)}
                    style={{
                      backgroundColor: v ? 'var(--accent)' : 'var(--paper)',
                      borderColor: v ? 'var(--accent)' : 'var(--line)',
                      color: v ? '#fff' : 'var(--ink)',
                      transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                    }}
                    className="w-[58px] h-[64px] text-center text-2xl font-display font-semibold rounded-xl border-2 focus:outline-none focus:border-[var(--accent)] caret-transparent"
                  />
                ))}
              </div>

              {loading && (
                <div className="flex items-center justify-center lg:justify-start gap-2 mt-6 text-[var(--ink-soft)]">
                  <span className="w-4 h-4 border-2 border-[var(--ink-faint)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Verifying…</span>
                </div>
              )}

              {error && !loading && (
                <div className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15 rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <div className="mt-8 flex items-center gap-4">
                <button onClick={resendOtp} className="text-xs text-[var(--accent)] font-medium hover:underline">
                  Didn't get it? Sign in again
                </button>
              </div>
              <p className="text-xs text-[var(--ink-faint)] mt-3">The code expires in 10 minutes. Check your spam folder if you don't see it.</p>
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
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">New PIN</p>
                  {renderBoxes(newPin, setNewPin, n)}
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">Confirm PIN</p>
                  {renderBoxes(confPin, setConfPin, c, (full) => submitNewPin(full))}
                </div>
              </div>

              <div className="mt-4 flex justify-center lg:justify-start">
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
