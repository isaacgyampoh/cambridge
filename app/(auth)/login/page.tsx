'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { PIN_LENGTH, OTP_LENGTH } from '@/lib/auth/pinPolicy'
import { PinBoxes } from '@/components/ui/PinFields'
import { BRAND } from '@/lib/brand'
import { useRouter } from 'next/navigation'


function LoginForm() {
  const router = useRouter()
  const [step,    setStep]    = useState<
    'pin' | 'otp' | 'set-pin' | 'recover-pin' | 'recover-otp' | 'recover-new'
  >('pin')
  const [pin,     setPin]     = useState('')
  /* The emailed code. A different length from the PIN, deliberately. */
  const [otp,     setOtp]     = useState('')
  const [otpUserId, setOtpUserId] = useState('')
  const [emailHint, setEmailHint] = useState('')
  const [resendIn,  setResendIn]  = useState(0)   // seconds until resend is offered
  const [codeLeft,  setCodeLeft]  = useState(0)   // seconds until the code expires
  const [pendingChangePin, setPendingChangePin] = useState(false)
  const [newPin,  setNewPin]  = useState('')
  const [confPin, setConfPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [notice,  setNotice]  = useState('')
  const busy = useRef(false)

  /* Account recovery. Separate state so it cannot be confused with sign-in. */
  const [recoverPin, setRecoverPin] = useState('')
  const [recoverNew, setRecoverNew] = useState('')
  const [recoverConfirm, setRecoverConfirm] = useState('')
  const [resetToken, setResetToken] = useState('')

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
      return
    }
    if (d.mustChangePIN) { setStep('set-pin'); return }
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
      setOtp('')
      return
    }
    if (d.mustChangePIN || pendingChangePin) { setStep('set-pin'); return }
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
        setOtp('')
        setCodeLeft(d.expiresInSeconds || 600)
        setResendIn(30)
        return
      }
      // A stale sign-in cannot be resumed — send them back to the PIN step.
      setError(d.error || 'Could not send a new code.')
      if (/expired/i.test(d.error || '')) {
        setStep('pin'); setPin('')
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
        return
      }

      setEmailHint(d.emailHint || '')
      setCodeLeft(d.expiresInSeconds || 600)
      setResendIn(30)
      setOtp('')
      setStep('recover-otp')
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
        setOtp('')
        return
      }
      setResetToken(d.resetToken)
      setStep('recover-new')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally { setLoading(false) }
  }

  async function finishRecovery() {
    if (recoverNew.length !== PIN_LENGTH) { setError(`Your new PIN must be exactly ${PIN_LENGTH} digits`); return }
    if (recoverNew !== recoverConfirm) {
      setError("Those PINs don't match — try again")
      setRecoverConfirm('')
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
    <div className="min-h-[100dvh] w-full flex" style={{ background: 'var(--paper)' }}>

      {/*
        The institutional panel.

        A flat navy field carrying the mark and the name. No gradient, no glow,
        no decorative geometry — the seriousness comes from the restraint, and
        from the fact that nothing on it is trying to sell anything.
      */}
      <aside className="hidden lg:flex flex-col justify-between flex-1 px-14 py-14"
        style={{ background: 'var(--navy)' }}>
        <div className="flex items-center gap-3.5">
          <span className="w-11 h-11 rounded-xl bg-white/95 grid place-items-center overflow-hidden p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" aria-hidden="true" className="w-full h-full object-contain" />
          </span>
          <span className="text-white text-[15px] font-semibold tracking-[0.02em] uppercase">
            {BRAND.shortName}
          </span>
        </div>

        <div className="max-w-sm">
          <p className="text-white text-[20px] leading-snug font-medium">
            {BRAND.tagline}
          </p>
        </div>

        <div className="flex items-center gap-4 text-white/45 text-[12px]">
          <span>Admissions</span>
          <span className="w-1 h-1 rounded-full bg-white/25" />
          <span>Student management</span>
          <span className="w-1 h-1 rounded-full bg-white/25" />
          <span>Communication</span>
        </div>
      </aside>

      {/* The form. */}
      <main className="flex-1 flex flex-col justify-center px-6 py-10 sm:py-14"
        style={{ background: 'var(--paper)' }}>
        <div className="w-full max-w-[340px] mx-auto">

          {/* On a phone the brand is a mark and a name. */}
          <div className="lg:hidden flex flex-col items-center mb-10">
            <span className="w-14 h-14 rounded-2xl grid place-items-center p-2.5 mb-3.5"
              style={{ background: 'var(--navy)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND.logo} alt="" aria-hidden="true"
                className="w-full h-full object-contain brightness-0 invert" />
            </span>
            <h1 className="text-[14px] font-semibold tracking-[0.06em] uppercase text-[var(--ink)]">
              {BRAND.shortName}
            </h1>
          </div>

          {step === 'pin' && (
            <>
              <div className="mb-9 text-center lg:text-left">
                <h2 className="text-[24px] font-semibold leading-tight text-[var(--ink)]">
                  Welcome back
                </h2>
                <p className="text-[var(--ink-soft)] text-[14px] mt-1.5">
                  Sign in to continue to your account.
                </p>
              </div>

              <p className="t-overline text-center lg:text-left mb-3.5">
                Enter your {PIN_LENGTH}-digit PIN
              </p>

              <div className="lg:flex lg:justify-start">
                <PinBoxes value={pin} onChange={setPin} onSubmit={submitPin} label="PIN" autoFocus
                  masked autoSubmit disabled={loading} invalid={Boolean(error) && !loading} />
              </div>

              {/*
                No button. The fourth digit IS the action.

                A confirm step after four digits is a second gesture for
                something already unambiguously finished. Submission is guarded
                inside PinBoxes, so a paste, autofill or a fast typist cannot
                fire it twice.
              */}
              <div className="h-5 mt-5 flex items-center justify-center lg:justify-start"
                aria-live="polite">
                {loading && (
                  <span className="inline-flex items-center gap-2 text-[13px] text-[var(--ink-soft)]">
                    <span className="w-3.5 h-3.5 border-2 border-[var(--line)] border-t-[var(--navy)] rounded-full animate-spin" />
                    Signing in…
                  </span>
                )}
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

              <p className="text-[13px] text-[var(--ink-faint)] mt-7 text-center lg:text-left">
                Forgot your PIN?{' '}
                <button
                  onClick={() => {
                    setStep('recover-pin'); setRecoverPin(''); setError(''); setNotice('')
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

              <PinBoxes
                value={otp}
                onChange={setOtp}
                onSubmit={submitOtp}
                label="Sign-in code"
                masked={false}
                autoSubmit
                autoFocus
                length={OTP_LENGTH}
                disabled={loading || codeLeft <= 0}
                invalid={Boolean(error)}
              />

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
                <button onClick={() => { setStep('pin'); setPin(''); setError('') }}
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

              <PinBoxes value={recoverPin} onChange={setRecoverPin} onSubmit={startRecovery} label='Recovery PIN' autoFocus
                masked autoSubmit disabled={loading} />

              <div className="h-6 mt-5 flex items-center justify-center lg:justify-start" aria-live="polite">
                {loading && (
                  <span className="inline-flex items-center gap-2 t-sub">
                    <span className="w-3.5 h-3.5 border-2 border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin" />
                    Checking…
                  </span>
                )}
              </div>

              {error && !loading && (
                <div role="alert"
                  className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15 rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <button
                onClick={() => { setStep('pin'); setPin(''); setError('') }}
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

              <PinBoxes
                value={otp}
                onChange={setOtp}
                onSubmit={submitRecoveryCode}
                label="Recovery code"
                masked={false}
                autoSubmit
                autoFocus
                length={OTP_LENGTH}
                disabled={loading || codeLeft <= 0}
                invalid={Boolean(error)}
              />

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
                onClick={() => { setStep('recover-pin'); setRecoverPin(''); setError('') }}
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
                  <PinBoxes value={recoverNew} onChange={setRecoverNew} label='New PIN' masked autoFocus />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">
                    Confirm PIN
                  </p>
                  <PinBoxes value={recoverConfirm} onChange={setRecoverConfirm} label='Confirm PIN' masked />
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
                  <PinBoxes value={newPin} onChange={setNewPin} label='New PIN' masked autoFocus />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.12em] mb-3 text-center lg:text-left">Confirm PIN</p>
                  <PinBoxes value={confPin} onChange={setConfPin} label='Confirm PIN' masked />
                </div>
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
