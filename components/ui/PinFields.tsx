'use client'

import { useRef, useEffect } from 'react'
import { PIN_LENGTH } from '@/lib/auth/pinPolicy'

/**
 * PIN and code entry: secure fields, filled from the device keyboard.
 *
 * ── WHY FIELDS AND NOT A KEYPAD ────────────────────────────────────────────
 *
 * An on-screen keypad was tried and rejected. It is calculator furniture in a
 * product that should feel like an application, and it takes entry away from
 * the keyboard people already have — including hardware keyboards, password
 * managers and one-time-code autofill.
 *
 * ── WHY A MODULE-SCOPE COMPONENT ───────────────────────────────────────────
 *
 * This began as a render function inside the page, and a component DEFINED
 * INSIDE a render body gets a fresh identity every pass, so React remounts it
 * on each keystroke — losing focus and dropping fast typing. Declared here the
 * identity is stable, the inputs stay mounted, and the component owns its own
 * refs rather than having them threaded in on every call.
 *
 * ── ONE COMPONENT FOR BOTH LENGTHS ─────────────────────────────────────────
 *
 * ── WHY IT LIVES IN THE DESIGN SYSTEM ──────────────────────────────────────
 *
 * There were four implementations of "type a PIN" in this product: sign-in,
 * the emailed code, account recovery, and the change-PIN screen. The last of
 * those defined its input row INSIDE the component body, so React gave it a
 * fresh identity on every render and remounted it on every keystroke —
 * meaning focus was lost after each digit and the PIN could not be typed
 * straight through. That is the bug this file exists to make unrepeatable.
 *
 * `length` is a prop so the four-digit PIN and the six-digit emailed code are
 * the SAME control. They were previously two implementations that had drifted
 * into two different appearances — filled accent blocks for the code, outlined
 * fields for the PIN — on adjacent steps of one flow.
 */
export function PinBoxes({
  value, onChange, onSubmit, label, masked,
  autoSubmit = false, disabled = false, autoFocus = false, length = PIN_LENGTH,
  invalid = false,
}: {
  value: string
  onChange: (next: string) => void
  /** Receives the completed value, so it never reads a stale closure. */
  onSubmit?: (completed: string) => void
  label: string
  masked: boolean
  autoSubmit?: boolean
  disabled?: boolean
  autoFocus?: boolean
  length?: number
  /** Paint the fields as rejected without moving anything. */
  invalid?: boolean
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  /*
   * The value already handed to onSubmit.
   *
   * Submitting on the last digit gives several ways to fire twice: typing the
   * final digit, pasting into the same field, autofill, React re-running the
   * handler. Remembering what was submitted makes it idempotent for a given
   * value, and it resets the moment the person edits, so a rejected PIN can be
   * retried immediately.
   */
  const submitted = useRef<string | null>(null)

  const focus = (i: number) =>
    boxes.current[Math.max(0, Math.min(i, length - 1))]?.focus()

  useEffect(() => {
    if (autoFocus && !disabled && value === '') focus(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, disabled, value === ''])

  const commit = (next: string) => {
    onChange(next)
    if (next.length < length) { submitted.current = null; return }
    if (!autoSubmit || !onSubmit || submitted.current === next) return
    submitted.current = next
    onSubmit(next)
  }

  return (
    <div className="flex gap-2.5 sm:gap-3 justify-center" role="group"
      aria-label={`${label}, ${length} digits`}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={el => { boxes.current[i] = el }}
          type={masked ? 'password' : 'text'}
          aria-label={`${label}, digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          disabled={disabled}
          // The OS offers an emailed code on the first field only.
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          value={value[i] || ''}
          onChange={e => {
            const digit = e.target.value.replace(/\D/g, '').slice(-1)
            // Typing into a field replaces everything from it onwards, so a
            // correction never leaves a stale digit behind the cursor.
            commit((value.slice(0, i) + digit).slice(0, length))
            if (digit) focus(i + 1)
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); focus(i - 1); return }
            if (e.key === 'ArrowRight' && i + 1 < length) { e.preventDefault(); focus(i + 1); return }
            if (e.key !== 'Backspace') return
            e.preventDefault()
            if (value[i]) commit(value.slice(0, i))
            else if (i > 0) { commit(value.slice(0, i - 1)); focus(i - 1) }
          }}
          onPaste={e => {
            const digits = e.clipboardData.getData('text').replace(/\D/g, '')
            if (!digits) return
            e.preventDefault()
            const next = (value.slice(0, i) + digits).slice(0, length)
            commit(next)
            focus(next.length)
          }}
          onFocus={e => e.target.select()}
          /*
           * Sized in a clamp rather than fixed pixels.
           *
           * Four 52px boxes plus their gaps need 232px, which is most of a
           * 320px screen once the page padding is taken off — and six of them,
           * for the emailed code, did not fit at all. This grows with the
           * viewport and stops at a comfortable size.
           *
           * The filled state is a quiet border change, not a colour fill.
           * Green on this screen is spent on the ring of the field you are
           * actually in, and nowhere else.
           */
          className={`w-[clamp(44px,13vw,54px)] h-[clamp(52px,15vw,60px)]
            text-center text-[19px] font-semibold rounded-[14px]
            bg-[var(--paper)] text-[var(--ink)] caret-[var(--accent)]
            border transition-[border-color,box-shadow] duration-150
            focus:outline-none focus:border-[var(--accent)]
            focus:ring-[3px] focus:ring-[var(--accent)]/18
            disabled:opacity-50
            ${invalid
              ? 'border-[var(--danger)]'
              : value[i]
                ? 'border-[var(--ink-faint)]'
                : 'border-[var(--line)]'}`}
        />
      ))}
    </div>
  )
}
