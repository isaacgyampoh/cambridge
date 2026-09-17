'use client'

import { useState, useRef, useEffect } from 'react'
import { PIN_LENGTH, OTP_LENGTH } from '@/lib/auth/pinPolicy'
import { PinBoxes } from '@/components/ui/PinFields'
import { BRAND } from '@/lib/brand'
import { useRouter } from 'next/navigation'


/**
 * The sign-in form.
 *
 * `heroSrc` is resolved on the server (see page.tsx) — the URL of the
 * photograph of the centre, or null when none has been saved yet. A real
 * photograph supplied by the institution; never stock, never generated.
 *
 * Portrait or landscape both work: it is object-cover with a top-biased focal
 * point, so a person stays in frame as the crop changes from a wide banner on
 * a phone to a tall column on a desktop.
 */
/**
 * The time left on a code, in words that fit the window.
 *
 * This was always `m:ss`, which was right while a code lived ten minutes and
 * reads as "359:12" now that one lives six hours — a number nobody parses as
 * a duration.
 */
function formatCodeLeft(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.round((seconds % 3600) / 60)
    if (mins === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
    return `${hours} hour${hours === 1 ? '' : 's'} ${mins} min`
  }
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min`
  return `${seconds}s`
}

export default function LoginForm({ heroSrc }: { heroSrc: string | null }) {
  const router = useRouter()
  /*
   * Whether the photograph decoded.
   *
   * The SERVER already told us whether a file exists, so the panel is only
   * rendered when one does — no flash, no broken-image glyph, and no second
   * crest competing with the lockup. This flag covers the remaining case: the
   * file exists but the bytes fail to decode.
   */
  const hasHero = Boolean(heroSrc)
  const [heroOk, setHeroOk] = useState(hasHero)
  const [step,    setStep]    = useState<
    'pin' | 'otp' | 'set-pin' | 'recover-pin' | 'recover-email' | 'recover-otp' | 'recover-new'
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
  /* Super admin recovery: one configured address, used only to receive a code. */
  const [recoverEmail, setRecoverEmail] = useState('')

  /**
   * Start super admin recovery.
   *
   * Reuses the shared OTP steps from here on — the code is checked by
   * /recover/verify and the new PIN set by /recover/complete, exactly as for
   * staff. Only the way the code is REQUESTED differs.
   */
  async function startSuperAdminRecovery() {
    if (loading || !recoverEmail.trim()) return
    setLoading(true); setError('')
    try {
      const d = await fetch('/api/auth/recover/super-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoverEmail.trim() }),
      }).then(r => r.json())

      if (!d.success) {
        setError(d.error || 'Recovery could not be started.')
        return
      }
      /*
       * Deliberately the same path whether or not the address matched. The
       * server answers identically, so a wrong address simply fails at the
       * code step — which is what stops this becoming a way to discover the
       * recovery mailbox by guessing.
       */
      setOtpUserId(d.userId)
      setEmailHint('the recovery email')
      setCodeLeft(d.expiresInSeconds || 600)
      setOtp('')
      setStep('recover-otp')
    } catch {
      setError('Recovery could not be started. Please try again.')
    } finally {
      setLoading(false)
    }
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
    /*
      ── THE SIGN-IN SCREEN ────────────────────────────────────────────────

      A photograph anchors it, and everything else is quiet.

      The screen before this was typographically clean and completely without
      identity: a mark, two lines and four boxes floating in a large empty
      field. Nothing on it said which institution it belonged to, and on a
      desktop the content occupied a small island in the middle of a blank
      canvas.

      The photograph does the work that a colour block was doing badly. On a
      phone it caps the top of the screen; from lg it becomes the left half.
      Nothing is written over it and no gradient is laid on top — it is a
      picture of the place, not a container for text.

      Green still appears exactly twice: the ring on the field being filled,
      and the recovery link. The crest is crimson and stays crimson; it sits
      on white where it reads as itself.
    */
    <div className="min-h-[100dvh] w-full flex flex-col lg:flex-row"
      style={{ background: 'var(--canvas)' }}>

      {/*
        The picture.

        Rendered only when there IS one. A dark panel with the crest in it
        would put the same mark on screen twice — once here and once in the
        lockup below — and a large empty colour block is the thing this
        redesign exists to remove. With no photograph the screen is simply the
        calm centred composition.

        Sized in dvh so it yields on a short screen rather than pushing the PIN
        below the fold: the whole point of the screen is the four boxes.
        object-cover with a top-biased focal point keeps faces in frame as the
        crop changes with the viewport, instead of cutting through them.
      */}
      {hasHero && (
        <div className="relative flex-shrink-0 overflow-hidden
          h-[clamp(150px,30dvh,300px)] rounded-b-[28px]
          lg:h-auto lg:w-[46%] lg:max-w-[620px] lg:rounded-none lg:rounded-r-[36px]"
          style={{ background: 'var(--brand)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroSrc as string}
            alt=""
            aria-hidden="true"
            onError={() => setHeroOk(false)}
            /*
             * object-position, chosen for a person photographed standing.
             *
             * On a phone this is a wide, short band cut from a tall picture,
             * and with object-cover the percentage selects WHICH band: 0%
             * shows the very top, 100% the bottom. A face sits around a fifth
             * of the way down a standing portrait, so 20% frames the head and
             * shoulders. It was 28%, which centred the band just below the
             * face and clipped the top of the head against the upper edge —
             * seen in a browser, not reasoned about.
             *
             * From lg the panel is a tall column and a portrait fills it
             * naturally, so it simply centres.
             */
            className={`absolute inset-0 w-full h-full object-cover
              object-[center_20%] lg:object-[center_center]
              transition-opacity duration-500 ${heroOk ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
      )}

      {/* The authentication column. */}
      {/*
        justify-start on a phone so the lockup can genuinely overlap the
        picture's lower edge — with justify-center the column was centred in
        the leftover space and the negative margin did nothing, leaving the
        mark stranded in the middle of the page.
      */}
      {/*
        The authentication side is its own column.

        Without this wrapper the footer became a THIRD item in the row from lg
        up and floated to the top-right corner of the screen, beside the
        picture rather than beneath the form.

        relative + z-10 so the lockup sits ON the picture's lower edge rather
        than behind it: the panel is earlier in the DOM, so without it the
        crest was half-clipped by the image it is meant to overlap.
      */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
      {/*
        pb-[14vh] with justify-center, which lifts the composition above the
        true middle by about 7vh.
        
        Centred exactly, the four boxes landed at the vertical midpoint of the
        screen with an equal void above and below — which reads as a page that
        did not finish loading, and puts the field precisely where the
        software keyboard covers it. Optical centre is above geometric centre
        for a composition that is read top-down, and lifting it also keeps the
        boxes visible once the keyboard opens.
        
        Only when there is no photograph: with one, the column starts under
        the picture and the spacing is already resolved.
      */}
      <main className={`flex-1 w-full flex flex-col items-center
        px-5 pb-8 sm:px-6 lg:px-10
        ${hasHero ? 'justify-start lg:justify-center' : 'justify-center pb-[14vh] lg:pb-8'}`}>
        <div className="w-full max-w-[360px] lg:max-w-[380px]">

          {/*
            The lockup.

            It lifts over the photograph's lower edge on a phone, which is what
            joins the two halves of the screen into one composition instead of
            two stacked blocks. From lg the picture is beside rather than above,
            so it sits normally.
          */}
          <div className={`flex flex-col items-center mb-7 lg:mb-9
            ${hasHero ? '-mt-9 lg:mt-0' : 'mt-0'}`}>
            <span className="w-[68px] h-[68px] rounded-[22px] grid place-items-center p-3
              bg-[var(--paper)] shadow-[0_4px_20px_-6px_rgba(16,35,28,0.18)]
              ring-1 ring-[var(--line)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND.logo} alt="" aria-hidden="true"
                className="w-full h-full object-contain" />
            </span>
            <h1 className="mt-3.5 text-[12px] font-semibold tracking-[0.16em]
              uppercase text-[var(--ink-faint)]">
              {BRAND.shortName}
            </h1>
          </div>

          {step === 'pin' && (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-[22px] sm:text-[24px] font-semibold leading-tight
                  tracking-[-0.01em] text-[var(--ink)]">
                  Welcome back
                </h2>
                {/*
                  The instruction, visible.
                
                  `label="PIN"` below reaches a screen reader through
                  aria-label and nothing else, so a sighted person arrived at
                  four empty boxes with "Sign in securely to continue" above
                  them and nothing anywhere saying what goes in them. The
                  length comes from PIN_LENGTH so the sentence cannot drift
                  from the number of boxes it describes.
                */}
                <p className="text-[var(--ink-soft)] text-[14px] mt-1.5 leading-snug">
                  Enter your {PIN_LENGTH}-digit PIN to continue.
                </p>
              </div>

              <PinBoxes value={pin} onChange={setPin} onSubmit={submitPin} label="PIN" autoFocus
                masked autoSubmit disabled={loading} invalid={Boolean(error) && !loading} />

              {/*
                No button. The fourth digit IS the action.

                A confirm step after four digits is a second gesture for
                something already unambiguously finished. Submission is guarded
                inside PinBoxes, so a paste, autofill or a fast typist cannot
                fire it twice.
              */}
              <div className="h-5 mt-4 flex items-center justify-center" aria-live="polite">
                {loading && (
                  <span className="inline-flex items-center gap-2 text-[13px] text-[var(--ink-soft)]">
                    <span className="w-3.5 h-3.5 border-2 border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin" />
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

              <p className="text-[13px] text-[var(--ink-soft)] mt-6 text-center">
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
                  ? `This code expires in ${formatCodeLeft(codeLeft)}.`
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
                  Enter your {PIN_LENGTH}-digit recovery PIN. Staff accounts then receive a
                  code by email; the super admin goes straight to choosing a new PIN.
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

              {/*
                The super admin's own way back.
                Their normal route is the recovery PIN above — no code, because
                they have no corporate mailbox. This is for when that PIN is
                gone too, and it is the difference between a locked-out owner
                and a deployment secret in a query string.
              */}
              <button
                onClick={() => { setStep('recover-email'); setError(''); setRecoverEmail('') }}
                className="mt-3 text-[13px] text-[var(--ink-faint)] hover:text-[var(--ink)] hover:underline
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1 -mx-1">
                Super admin recovery
              </button>
            </>
          )}

          {step === 'recover-email' && (
            <>
              <div className="mb-8">
                <h2 className="font-display text-[24px] leading-tight font-semibold text-[var(--ink)] mb-1.5">
                  Super admin PIN recovery
                </h2>
                <p className="text-[var(--ink-soft)] text-sm">
                  Enter the recovery email configured for the super admin. We will send a
                  verification code to it.
                </p>
              </div>

              <form onSubmit={e => { e.preventDefault(); startSuperAdminRecovery() }}>
                <label htmlFor="recovery-email" className="block text-[13px] font-medium text-[var(--ink)]">
                  Recovery email
                </label>
                {/*
                  16px, or iOS Safari zooms the page on focus and the person
                  loses their place — on the one screen where they are already
                  locked out and anxious.
                */}
                <input
                  id="recovery-email" type="email" inputMode="email" autoComplete="off"
                  autoFocus value={recoverEmail} onChange={e => setRecoverEmail(e.target.value)}
                  disabled={loading} enterKeyHint="send"
                  className="mt-1.5 w-full min-h-[48px] rounded-xl border border-[var(--line)]
                    bg-[var(--canvas)] px-3.5 text-[16px] text-[var(--ink)]" />

                <button type="submit" disabled={loading || !recoverEmail.trim()}
                  className="mt-4 w-full min-h-[48px] rounded-xl bg-[var(--accent)]
                    text-[var(--accent-ink)] text-[15px] font-semibold disabled:opacity-60">
                  {loading ? 'Sending…' : 'Send code'}
                </button>
              </form>

              {error && !loading && (
                <div role="alert"
                  className="mt-6 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger)]/15
                    rounded-xl text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <button
                onClick={() => { setStep('recover-pin'); setError('') }}
                className="mt-6 text-[13px] text-[var(--ink-faint)] hover:text-[var(--ink)] hover:underline
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded px-1 -mx-1">
                Back
              </button>
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
                <div className="mt-5 px-4 py-3 bg-[var(--danger-soft)] border border-[var(--danger-soft)] rounded-xl text-sm text-[var(--danger)]">
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

        </div>
      </main>

      {/*
        Pinned to the foot of the page rather than trailing the form.

        It used to sit inside the centred column with mt-12, so it was
        left-aligned against centred content and landed in the middle of the
        screen with a void beneath it.
      */}
      <footer className="flex-shrink-0 pb-7 px-5 text-center safe-b">
        <p className="text-[11px] text-[var(--ink-faint)]">
          {BRAND.name} · {new Date().getFullYear()}
        </p>
      </footer>
      </div>
    </div>
  )
}
