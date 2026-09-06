'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { PIN_LENGTH, OTP_LENGTH } from '@/lib/auth/pinPolicy'
import { BRAND } from '@/lib/brand'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'

/**
 * PIN entry. Exactly PIN_LENGTH boxes — four.
 *
 * ── WHY A MODULE-SCOPE COMPONENT ───────────────────────────────────────────
 *
 * This began as a render function inside the page, because a component
 * DEFINED INSIDE a render body gets a fresh identity every pass and React
 * remounts it on each keystroke — losing focus and dropping fast typing.
 *
 * Declaring it here removes that hazard entirely: the identity is stable, so
 * the inputs stay mounted, and the component owns its own refs instead of
 * having them threaded in as an argument on every call.
 *
 * ── BEHAVIOUR ──────────────────────────────────────────────────────────────
 *
 * There is no auto-submit. Submitting the moment a fourth digit lands means a
 * mistyped digit navigates before it can be corrected, which matters most in
 * recovery where the next step changes a credential. Enter submits; otherwise
 * the caller supplies an explicit button.
 */
function PinBoxes({
  value, onChange, onSubmit, label, masked,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
  label: string
  masked: boolean
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(i, PIN_LENGTH - 1))]?.focus()

  return (
    <div className="flex gap-2 sm:gap-2.5 justify-center lg:justify-start"
      role="group" aria-label={`${label}, ${PIN_LENGTH} digits`}>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={el => { boxes.current[i] = el }}
          type={masked ? 'password' : 'text'}
          aria-label={`${label}, digit ${i + 1} of ${PIN_LENGTH}`}
          inputMode="numeric"
          maxLength={1}
          autoComplete="off"
          value={value[i] || ''}
          onChange={e => {
            const digit = e.target.value.replace(/\D/g, '').slice(-1)
            // Typing into a box replaces everything from it onwards, so a
            // correction never leaves a stale digit behind the cursor.
            const next = (value.slice(0, i) + digit).slice(0, PIN_LENGTH)
            onChange(next)
            if (digit) focus(i + 1)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && value.length === PIN_LENGTH && onSubmit) { onSubmit(); return }
            if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); focus(i - 1); return }
            if (e.key === 'ArrowRight' && i + 1 < PIN_LENGTH) { e.preventDefault(); focus(i + 1); return }
            if (e.key !== 'Backspace') return
            e.preventDefault()
            if (value[i]) onChange(value.slice(0, i))
            else if (i > 0) { onChange(value.slice(0, i - 1)); focus(i - 1) }
          }}
          onPaste={e => {
            const digits = e.clipboardData.getData('text').replace(/\D/g, '')
            if (!digits) return
            e.preventDefault()
            const next = (value.slice(0, i) + digits).slice(0, PIN_LENGTH)
            onChange(next)
            focus(next.length)
          }}
          onFocus={e => e.target.select()}
          style={{
            backgroundColor: value[i] ? 'var(--accent)' : 'var(--paper)',
            borderColor: value[i] ? 'var(--accent)' : 'var(--line)',
            color: value[i] ? '#fff' : 'var(--ink)',
            transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
          }}
          className="w-[clamp(52px,16vw,64px)] h-[clamp(58px,18vw,70px)] text-center text-[24px] font-display font-semibold rounded-2xl border-2 focus:outline-none focus:border-[var(--accent)] caret-transparent shadow-[var(--shadow-raised)] focus:ring-4 focus:ring-[var(--accent-soft)]"
        />
      ))}
    </div>
  )
}

function LoginForm() {
  const router = useRouter()
  const [step,    setStep]    = useState<
    'pin' | 'otp' | 'set-pin' | 'recover-pin' | 'recover-otp' | 'recover-new'
  >('pin')
  const [pin,     setPin]     = useState('')
  /* The emailed code. A different length from the PIN, deliberately. */
  const [otp,     setOtp]     = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [otpUserId, setOtpUserId] = useState('')
  const [emailHint, setEmailHint] = useState('')
  const [resendIn,  setResendIn]  = useState(0)   // seconds until resend is offered
  const [codeLeft,  setCodeLeft]  = useState(0)   // seconds until the code expires
  const [pendingChangePin, setPendingChangePin] = useState(false)
  const [newPin,  setNewPin]  = useState('')
  const [confPin, setConfPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [notice,  setNotice]  = useState('')
  const busy = useRef(false)

  /* Account recovery. Separate state so it cannot be confused with sign-in. */
  const [recoverPin, setRecoverPin] = useState('')
  const [recoverNew, setRecoverNew] = useState('')
  const [recoverConfirm, setRecoverConfirm] = useState('')
  const [resetToken, setResetToken] = useState('')

  /*
   * Eight boxes each, because a PIN is four to EIGHT digits — that is the
   * contract on /api/auth/verify-pin and /api/auth/change-pin.
   *
   * The form rendered exactly four and submitted the moment the fourth was
   * filled, so a PIN longer than four could neither be entered nor set. That
   * made the account-recovery route unusable: /api/auth/first-run issues an
   * eight-digit PIN, which there was no way to type. The set-PIN screen also
   * told people "six digits is safer than four" while giving them four boxes.
   *
   * Written out rather than built with Array.from, because a hook may not be
   * called from inside a callback.
   */
  /*
   * One ref holding the boxes, assigned through callback refs.
   *
   * Indexing an array of individual useRef objects during render is what the
   * react-hooks rule objects to, and it grew a warning per call site as the
   * recovery screens were added. A single array ref written from a callback
   * is the supported shape and behaves identically.
   */
  type Boxes = React.RefObject<(HTMLInputElement | null)[]>
  const p = useRef<(HTMLInputElement | null)[]>([])
  const n = useRef<(HTMLInputElement | null)[]>([])
  const c = useRef<(HTMLInputElement | null)[]>([])

  const o = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { setTimeout(() => p.current[0]?.focus(), 120) }, [])

  function handleDigit(val: string, i: number, arr: string[], set: React.Dispatch<React.SetStateAction<string[]>>, refs: Boxes, onFull?: (s: string) => void) {
    if (!/^\d*$/.test(val)) return
    const ch = val.slice(-1)
    // Compute the next array from the CURRENT props (arr is the live value
    // for this box passed from render), update state, THEN do side effects
    // (focus / submit) outside the updater so they always run exactly once.
    const next = [...arr]
    next[i] = ch
    set(next)
    if (!ch) return
    if (i < arr.length - 1) {
      refs.current[i + 1]?.focus()
    } else {
      const full = next.join('')
      if (full.length === arr.length && onFull && !busy.current) {
        onFull(full)
      }
    }
  }

  function handleBksp(e: React.KeyboardEvent, i: number, arr: string[], set: React.Dispatch<React.SetStateAction<string[]>>, refs: typeof p) {
    // Arrow keys move between boxes, so a mistyped digit can be corrected
    // without deleting everything after it.
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); refs.current[i - 1]?.focus(); return }
    if (e.key === 'ArrowRight' && i < arr.length - 1) { e.preventDefault(); refs.current[i + 1]?.focus(); return }
    if (e.key !== 'Backspace') return
    const next = [...arr]
    if (next[i]) { next[i] = ''; set(next) }
    else if (i > 0) { next[i - 1] = ''; set(next); refs.current[i - 1]?.focus() }
  }

  /**
   * Paste a whole code across the boxes.
   *
   * Almost nobody retypes a six-digit code they can copy out of an email, and
   * without this the paste landed a single digit in one box — the last
   * character, because each box takes only one. Digits are extracted rather
   * than the string used as-is, so a code pasted as "123 456" or with a
   * trailing newline still works.
   */
  function handlePaste(
    e: React.ClipboardEvent, i: number, arr: string[],
    set: React.Dispatch<React.SetStateAction<string[]>>, refs: Boxes,
    onFull?: (s: string) => void
  ) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!digits) return
    e.preventDefault()

    const next = [...arr]
    for (let k = 0; k < digits.length && i + k < arr.length; k++) next[i + k] = digits[k]
    set(next)

    const landed = Math.min(i + digits.length, arr.length - 1)
    refs.current[landed]?.focus()

    const full = next.join('')
    if (full.length === arr.length && !next.includes('') && onFull && !busy.current) onFull(full)
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
      setPin('')
      setTimeout(() => p.current[0]?.focus(), 80)
      return
    }
    // PIN correct → an OTP was emailed. Move to the OTP step.
    if (d.otpRequired) {
      setOtpUserId(d.userId)
      setEmailHint(d.emailHint || '')
      setPendingChangePin(!!d.mustChangePIN)
      setCodeLeft(d.expiresInSeconds || 600)
      setResendIn(30)
      setStep('otp')
      setTimeout(() => o.current[0]?.focus(), 120)
      return
    }
    if (d.mustChangePIN) { setStep('set-pin'); setTimeout(() => n.current[0]?.focus(), 100); return }
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
      setOtp(Array(OTP_LENGTH).fill(''))
      setTimeout(() => o.current[0]?.focus(), 80)
      return
    }
    if (d.mustChangePIN || pendingChangePin) { setStep('set-pin'); setTimeout(() => n.current[0]?.focus(), 100); return }
    router.replace(d.redirect || '/admin')
  }

  async function resendOtp() {
    if (resendIn > 0 || loading) return
    setLoading(true); setError('')
    try {
      const d = await fetch('/api/auth/resend-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otpUserId }),
      }).then(r => r.json())

      if (d.success) {
        setOtp(Array(OTP_LENGTH).fill(''))
        setCodeLeft(d.expiresInSeconds || 600)
        setResendIn(30)
        setTimeout(() => o.current[0]?.focus(), 80)
        return
      }
      // A stale sign-in cannot be resumed — send them back to the PIN step.
      setError(d.error || 'Could not send a new code.')
      if (/expired/i.test(d.error || '')) {
        setStep('pin'); setPin('')
        setTimeout(() => p.current[0]?.focus(), 100)
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  /* ── account recovery ─────────────────────────────────────────────────
     recovery PIN → code to the corporate mailbox → choose a new PIN.

     The recovery PIN alone proves nothing: without the mailbox there is no
     way through, which is what stops a four-digit code being a back door. */

  async function startRecovery() {
    if (recoverPin.length !== PIN_LENGTH) return
    setLoading(true); setError('')
    try {
      const d = await fetch('/api/auth/recover/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: recoverPin }),
      }).then(r => r.json())
      if (!d.success) { setError(d.error || 'That recovery PIN is not recognised.'); return }
      setOtpUserId(d.userId)

      /*
       * An account with no mailbox — the super admin — is already authorised.
       * Showing it a "check your email" screen would strand the one account
       * that has no email to check.
       */
      if (d.needsCode === false && d.resetToken) {
        setResetToken(d.resetToken)
        setStep('recover-new')
        setTimeout(() => n.current[0]?.focus(), 120)
        return
      }

      setEmailHint(d.emailHint || '')
      setCodeLeft(d.expiresInSeconds || 600)
      setResendIn(30)
      setOtp(Array(OTP_LENGTH).fill(''))
      setStep('recover-otp')
      setTimeout(() => o.current[0]?.focus(), 120)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally { setLoading(false) }
  }

  async function submitRecoveryCode(code: string) {
    setLoading(true); setError('')
    try {
      const d = await fetch('/api/auth/recover/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: otpUserId, code }),
      }).then(r => r.json())
      if (!d.success) {
        setError(d.error || 'That code is not correct.')
        setOtp(Array(OTP_LENGTH).fill(''))
        setTimeout(() => o.current[0]?.focus(), 80)
        return
      }
      setResetToken(d.resetToken)
      setStep('recover-new')
      setTimeout(() => n.current[0]?.focus(), 120)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally { setLoading(false) }
  }

  async function finishRecovery() {
    if (recoverNew.length !== PIN_LENGTH) { setError(`Your new PIN must be exactly ${PIN_LENGTH} digits`); return }
    if (recoverNew !== recoverConfirm) {
      setError("Those PINs don't match — try again")
      setRecoverConfirm('')
      setTimeout(() => c.current[0]?.focus(), 80)
      return
    }
    setLoading(true); setError('')
    try {
      const d = await fetch('/api/auth/recover/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPin: recoverNew }),
      }).then(r => r.json())
      if (!d.success) { setError(d.error || 'Could not set your new PIN.'); return }
      // Back to the front door. Recovery never creates a session, so the new
      // PIN goes through the normal PIN + OTP flow like any other sign-in.
      setStep('pin')
      setPin(''); setRecoverPin(''); setRecoverNew(''); setRecoverConfirm(''); setResetToken('')
      setError('')
      setNotice('Your PIN has been changed. Sign in with your new PIN.')
      setTimeout(() => p.current[0]?.focus(), 120)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally { setLoading(false) }
  }

  async function submitNewPin(confirmOverride?: string) {
    const np = newPin
    const cp = confirmOverride ?? confPin
    if (np.length !== PIN_LENGTH) { setError(`Your new PIN must be exactly ${PIN_LENGTH} digits`); return }
    if (cp.length !== PIN_LENGTH) { setError('Confirm your PIN'); return }
    if (np !== cp) {
      setError("PINs don't match — try again")
      setConfPin('')
      setTimeout(() => c.current[0]?.focus(), 80)
      return
    }
    setLoading(true); setError('')
    const res = await fetch('/api/auth/change-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPin: np }) })
    const d = await res.json()
    setLoading(false)
    if (d.success) router.replace('/admin')
    else setError(d.error || 'Failed')
  }

  // Counts the resend cooldown and the code's own expiry down together. State
  // is set from the interval callback, never synchronously in the effect body.
  useEffect(() => {
    if (step !== 'otp') return
    const id = setInterval(() => {
      setResendIn(v => (v > 0 ? v - 1 : 0))
      setCodeLeft(v => (v > 0 ? v - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [step])

  // A sign-in screen should never scroll — lock the document while it is open.
  useEffect(() => {
    document.documentElement.classList.add('app-shell')
    return () => document.documentElement.classList.remove('app-shell')
  }, [])

  return (
    <div className="min-h-[100dvh] w-full flex" style={{ background: 'var(--canvas)' }}>

      {/*
        The brand panel.

        A flat institutional field — no gradient, no radial glow, no decorative
        arcs. The previous version carried all three plus a marketing paragraph
        ("Where every lead becomes a graduate"), which is the language of a
        landing page, not of a tool people sign into forty times a week.
      */}
      <aside
        className="hidden lg:flex flex-col justify-between flex-1 px-14 py-12"
        style={{ background: 'var(--accent)' }}
      >
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg bg-white grid place-items-center overflow-hidden p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" aria-hidden="true" className="w-full h-full object-contain" />
          </span>
          <span className="text-white text-[15px] font-semibold tracking-tight">{BRAND.name}</span>
        </div>

        <div className="max-w-sm">
          <p className="text-white/60 t-overline mb-3">{BRAND.portalName}</p>
          <p className="text-white text-[17px] leading-snug">
            Leads, registrations, admissions and fees for {BRAND.shortName}.
          </p>
        </div>

        <p className="text-white/45 text-[12px]">
          Authorised staff only.
        </p>
      </aside>

      {/* The form. */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-10 sm:py-14">
        <div className="w-full max-w-[380px]">

          {/* On a phone the brand is a mark and a name, nothing more. */}
          <div className="lg:hidden flex flex-col items-center mb-9">
            <span className="w-14 h-14 rounded-xl bg-[var(--paper)] border border-[var(--line)] grid place-items-center p-2.5 mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND.logo} alt="" aria-hidden="true" className="w-full h-full object-contain" />
            </span>
            <h1 className="t-title text-center">{BRAND.name}</h1>
            <p className="t-meta mt-1">{BRAND.portalName}</p>
          </div>

          {step === 'pin' && (
            <>
              <div className="mb-8">
                <h2 className="t-display mb-1.5">Sign in</h2>
                <p className="text-[var(--ink-soft)] text-sm">
                  Enter your {PIN_LENGTH}-digit PIN to continue.
                </p>
              </div>

              <PinBoxes value={pin} onChange={setPin} onSubmit={() => submitPin(pin)} label='PIN' masked={!showPin} />

              {/* An explicit action, because the form no longer submits itself
                  the moment a fourth digit lands — that behaviour is what made
                  a PIN longer than four impossible to enter. */}
              <button
                onClick={() => submitPin(pin)}
                disabled={loading || pin.length !== PIN_LENGTH}
                className="w-full h-12 mt-6 bg-[var(--accent)] text-white rounded-xl font-semibold
                  text-[15px] hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none
                  transition-all flex items-center justify-center gap-2
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                  focus-visible:ring-offset-2">
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Opening your secure workspace…</>
                  : 'Continue'}
              </button>

              <div className="mt-3 flex justify-center lg:justify-start">
                <button onClick={() => setShowPin(s => !s)}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-2 text-[13px]
                    text-[var(--ink-faint)] hover:text-[var(--ink-soft)] transition-colors">
                  {showPin ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  {showPin ? 'Hide PIN' : 'Show PIN'}
                </button>
              </div>

              {notice && !error && (
                <div role="status"
                  className="mt-6 px-4 py-3 bg-[var(--ok-soft)] border border-[var(--ok)]/20 rounded-xl text-sm text-[var(--ok)]">
                  {notice}
                </div>
              )}

              {error && !loading && (
                <div role="alert"
                  className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15 rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <p className="text-xs text-[var(--ink-faint)] mt-8">
                Forgot your PIN?{' '}
                <button
                  onClick={() => {
                    setStep('recover-pin'); setRecoverPin(''); setError(''); setNotice('')
                    setTimeout(() => p.current[0]?.focus(), 100)
                  }}
                  className="font-semibold text-[var(--accent)] hover:underline
                    focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-[var(--accent)] rounded px-0.5">
                  Reset it securely
                </button>
              </p>
            </>
          )}

          {step === 'otp' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[24px] leading-tight font-semibold text-[var(--ink)] mb-1.5">Check your email</h2>
                <p className="text-[var(--ink-soft)] text-sm">We sent a {OTP_LENGTH}-digit code to {emailHint || 'your email'}. Enter it below to finish signing in.</p>
              </div>

              <div className="flex gap-1.5 sm:gap-2 justify-center lg:justify-start">
                {otp.map((v, i) => (
                  <input key={i} ref={el => { o.current[i] = el }}
                    type="text" inputMode="numeric" maxLength={1} value={v}
                    // The OS offers the code straight from the email or SMS on
                    // the first box, so it never has to be read and retyped.
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Sign-in code, digit ${i + 1} of ${OTP_LENGTH}`}
                    disabled={codeLeft <= 0}
                    onChange={e => handleDigit(e.target.value, i, otp, setOtp, o, submitOtp)}
                    onKeyDown={e => handleBksp(e, i, otp, setOtp, o)}
                    onPaste={e => handlePaste(e, i, otp, setOtp, o, submitOtp)}
                    onFocus={e => e.target.select()}
                    style={{
                      backgroundColor: v ? 'var(--accent)' : 'var(--paper)',
                      borderColor: v ? 'var(--accent)' : 'var(--line)',
                      color: v ? '#fff' : 'var(--ink)',
                      transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                    }}
                    className="w-[clamp(38px,11vw,48px)] h-[clamp(50px,14vw,58px)] text-center text-[17px] font-display font-semibold rounded-xl border-2 focus:outline-none focus:border-[var(--accent)] caret-transparent shadow-[var(--shadow-raised)] focus:ring-4 focus:ring-[var(--accent-soft)]"
                  />
                ))}
              </div>

              {loading && (
                <div className="flex items-center justify-center lg:justify-start gap-2 mt-6 text-[var(--ink-soft)]">
                  <span className="w-4 h-4 border-2 border-[var(--ink-faint)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Verifying…</span>
                </div>
              )}

              {/* An expired code is a different situation from a wrong one, and
                  needs a different instruction. The boxes are disabled above,
                  so this says why rather than leaving them mysteriously inert. */}
              {codeLeft <= 0 && !loading && (
                <div role="status"
                  className="mt-6 px-4 py-3 bg-[var(--warn-soft)] border border-[var(--warn)]/20 rounded-xl text-sm text-[var(--warn)]">
                  That code has expired. Send a new one to carry on.
                </div>
              )}

              {error && !loading && codeLeft > 0 && (
                <div role="alert"
                  className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15 rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button onClick={resendOtp} disabled={resendIn > 0 || loading}
                  className="text-[13px] font-semibold text-[var(--accent)] disabled:text-[var(--ink-faint)]
                    disabled:cursor-not-allowed hover:underline disabled:no-underline
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1 -mx-1">
                  {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
                </button>
                <button onClick={() => { setStep('pin'); setPin(''); setError(''); setTimeout(() => p.current[0]?.focus(), 80) }}
                  className="text-[13px] text-[var(--ink-faint)] hover:text-[var(--ink)] hover:underline
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1 -mx-1">
                  Start again
                </button>
              </div>

              <p className="text-xs text-[var(--ink-faint)] mt-3" aria-live="polite">
                {codeLeft > 0
                  ? `This code expires in ${Math.floor(codeLeft / 60)}:${String(codeLeft % 60).padStart(2, '0')}.`
                  : 'This code has expired — send a new one.'}
                {' '}Check your spam folder if it has not arrived.
              </p>
            </>
          )}

          {step === 'recover-pin' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[24px] sm:text-[24px] leading-tight font-semibold text-[var(--ink)] mb-1.5">
                  Reset your PIN
                </h2>
                <p className="text-[var(--ink-soft)] text-sm">
                  Enter your {PIN_LENGTH}-digit recovery PIN. If your account uses email
                  verification, we will send a code to confirm it is you.
                </p>
              </div>

              <PinBoxes value={recoverPin} onChange={setRecoverPin} onSubmit={startRecovery} label='Recovery PIN' masked={!showPin} />

              <button
                onClick={startRecovery}
                disabled={loading || recoverPin.length !== PIN_LENGTH}
                className="w-full h-12 mt-6 bg-[var(--accent)] text-white rounded-xl font-semibold
                  text-[15px] hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none
                  transition-all flex items-center justify-center gap-2
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                  focus-visible:ring-offset-2">
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking…</>
                  : 'Continue'}
              </button>

              {error && !loading && (
                <div role="alert"
                  className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15 rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <button
                onClick={() => { setStep('pin'); setPin(''); setError(''); setTimeout(() => p.current[0]?.focus(), 80) }}
                className="mt-6 text-[13px] text-[var(--ink-faint)] hover:text-[var(--ink)] hover:underline
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1 -mx-1">
                Back to sign in
              </button>

              <p className="text-xs text-[var(--ink-faint)] mt-6 leading-relaxed">
                No recovery PIN? Ask a super admin to reset your PIN from the Staff page.
              </p>
            </>
          )}

          {step === 'recover-otp' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[24px] leading-tight font-semibold text-[var(--ink)] mb-1.5">
                  Check your email
                </h2>
                <p className="text-[var(--ink-soft)] text-sm">
                  We sent a {OTP_LENGTH}-digit code to {emailHint || 'your email'}. Enter it to choose a new PIN.
                </p>
              </div>

              <div className="flex gap-1.5 sm:gap-2 justify-center lg:justify-start">
                {otp.map((v, i) => (
                  <input key={i} ref={el => { o.current[i] = el }}
                    type="text" inputMode="numeric" maxLength={1} value={v}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Recovery code, digit ${i + 1} of ${OTP_LENGTH}`}
                    disabled={codeLeft <= 0}
                    onChange={e => handleDigit(e.target.value, i, otp, setOtp, o, submitRecoveryCode)}
                    onKeyDown={e => handleBksp(e, i, otp, setOtp, o)}
                    onPaste={e => handlePaste(e, i, otp, setOtp, o, submitRecoveryCode)}
                    onFocus={e => e.target.select()}
                    style={{
                      backgroundColor: v ? 'var(--accent)' : 'var(--paper)',
                      borderColor: v ? 'var(--accent)' : 'var(--line)',
                      color: v ? '#fff' : 'var(--ink)',
                    }}
                    className="w-[clamp(38px,11vw,48px)] h-[clamp(50px,14vw,58px)] text-center text-[17px] font-display font-semibold rounded-xl border-2 focus:outline-none focus:border-[var(--accent)] caret-transparent shadow-[var(--shadow-raised)] focus:ring-4 focus:ring-[var(--accent-soft)]"
                  />
                ))}
              </div>

              {codeLeft <= 0 && !loading && (
                <div role="status"
                  className="mt-6 px-4 py-3 bg-[var(--warn-soft)] border border-[var(--warn)]/20 rounded-xl text-sm text-[var(--warn)]">
                  That code has expired. Start the reset again.
                </div>
              )}

              {error && !loading && codeLeft > 0 && (
                <div role="alert"
                  className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15 rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <button
                onClick={() => { setStep('recover-pin'); setRecoverPin(''); setError(''); setTimeout(() => p.current[0]?.focus(), 80) }}
                className="mt-8 text-[13px] text-[var(--ink-faint)] hover:text-[var(--ink)] hover:underline
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1 -mx-1">
                Start again
              </button>
            </>
          )}

          {step === 'recover-new' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[24px] leading-tight font-semibold text-[var(--ink)] mb-1.5">
                  Choose a new PIN
                </h2>
                <p className="text-[var(--ink-soft)] text-sm">
                  {PIN_LENGTH} digits, known only to you. You will use it to sign in from now on.
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">
                    New PIN
                  </p>
                  <PinBoxes value={recoverNew} onChange={setRecoverNew} onSubmit={undefined} label='New PIN' masked={!showPin} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">
                    Confirm PIN
                  </p>
                  <PinBoxes value={recoverConfirm} onChange={setRecoverConfirm} onSubmit={finishRecovery} label='Confirm PIN' masked={!showPin} />
                </div>
              </div>

              {error && !loading && (
                <div role="alert"
                  className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15 rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <button
                onClick={finishRecovery}
                disabled={loading || recoverNew.length !== PIN_LENGTH || recoverConfirm.length !== PIN_LENGTH}
                className="w-full h-12 mt-6 bg-[var(--accent)] text-white rounded-xl font-semibold
                  text-[15px] hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none
                  transition-all flex items-center justify-center gap-2
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                  focus-visible:ring-offset-2">
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                  : 'Set my PIN'}
              </button>
            </>
          )}

          {step === 'set-pin' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[24px] leading-tight font-semibold text-[var(--ink)] mb-1.5">Set your PIN</h2>
                <p className="text-[var(--ink-soft)] text-sm">Choose a PIN only you know. Four to eight digits — longer is safer.</p>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">New PIN</p>
                  <PinBoxes value={newPin} onChange={setNewPin} onSubmit={undefined} label='New PIN' masked={!showPin} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">Confirm PIN</p>
                  <PinBoxes value={confPin} onChange={setConfPin} onSubmit={() => submitNewPin()} label='Confirm PIN' masked={!showPin} />
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

              <button onClick={() => submitNewPin()} disabled={loading || newPin.length !== PIN_LENGTH || confPin.length !== PIN_LENGTH}
                className="w-full h-12 bg-[var(--accent)] text-white rounded-xl font-medium text-sm mt-6 hover:brightness-110 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Setting PIN…</>
                  : 'Set PIN and continue'}
              </button>
            </>
          )}

          <p className="text-[11px] text-[var(--ink-faint)] mt-12">
            Cambridge Center of Excellence · {new Date().getFullYear()}
          </p>
        </div>
      </main>
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
