'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Shield, Eye, EyeOff } from 'lucide-react'
import { PageHeader, Card, Button, PinBoxes } from '@/components/ui'
import { PIN_LENGTH, isValidPin, pinRejectionReason } from '@/lib/auth/pinPolicy'

/**
 * Changing your own PIN.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * This screen defined its input row as `const PinRow = (…) => …` INSIDE the
 * component body. A component declared during render gets a fresh identity on
 * every pass, so React unmounted and remounted all twelve inputs on each
 * keystroke — and a remounted input is not the focused one. Focus was lost
 * after every digit, which means the PIN could not be typed straight through.
 * The screen's own `refs[index + 1].current?.focus()` was moving focus into a
 * node that was about to be replaced.
 *
 * It was also the fourth implementation of "type a PIN" in the product, with
 * its own look — filled accent squares, 56px, border-2 — against the outlined
 * fields on sign-in and recovery. Three screens, three appearances, one task.
 *
 * It now uses the same PinBoxes as sign-in and recovery, which is declared at
 * module scope and cannot remount.
 *
 * ── AND THE RULES COME FROM ONE PLACE ──────────────────────────────────────
 *
 * The length was written as a literal 4 in five places here, and the only
 * validation was `length < 4`. Both now come from lib/auth/pinPolicy, which
 * is the single source of truth the whole system shares — including the
 * rejection of a PIN too obvious to use.
 */
export default function ChangePINPage() {
  const router = useRouter()
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!isValidPin(currentPin)) { setError('Enter your current PIN.'); return }

    // The same rule the server applies, so a weak PIN is refused here rather
    // than after a round trip that has already been told the current one.
    const rejection = pinRejectionReason(newPin)
    if (rejection) { setError(rejection); return }

    if (newPin !== confirmPin) { setError('The two new PINs do not match.'); return }
    if (newPin === currentPin) { setError('The new PIN must be different from the current one.'); return }

    setSaving(true); setError('')
    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin }),
      })
      const d = await res.json()
      if (d.success) {
        toast.success('Your PIN has been changed.')
        router.back()
        return
      }
      setError(d.error || 'That PIN could not be changed.')
      // Only the current PIN is cleared: if it was wrong, retyping the new one
      // as well is a punishment for the system's own uncertainty.
      setCurrentPin('')
    } catch {
      setError('The request did not go through. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const complete = isValidPin(currentPin) && isValidPin(newPin) && isValidPin(confirmPin)

  return (
    <div className="fade-in w-full max-w-[440px] mx-auto">
      <PageHeader
        eyebrow="Security"
        title="Change your PIN"
        description={`Your PIN is ${PIN_LENGTH} digits and is how you sign in.`}
      />

      <Card className="p-5 sm:p-6">
        <div className="space-y-6">
          {[
            { label: 'Current PIN', value: currentPin, set: setCurrentPin, autoFocus: true },
            { label: 'New PIN', value: newPin, set: setNewPin, autoFocus: false },
            { label: 'Confirm new PIN', value: confirmPin, set: setConfirmPin, autoFocus: false },
          ].map(field => (
            <div key={field.label}>
              <div className="t-overline mb-2.5">{field.label}</div>
              <PinBoxes
                label={field.label}
                value={field.value}
                onChange={next => { field.set(next); if (error) setError('') }}
                masked={!showPin}
                autoFocus={field.autoFocus}
                disabled={saving}
                invalid={Boolean(error)}
              />
            </div>
          ))}

          <button type="button" onClick={() => setShowPin(v => !v)}
            aria-pressed={showPin}
            className="inline-flex items-center gap-2 text-[13px] text-[var(--ink-soft)]
              hover:text-[var(--ink)] transition-colors">
            {showPin
              ? <EyeOff size={15} aria-hidden="true" />
              : <Eye size={15} aria-hidden="true" />}
            {showPin ? 'Hide the digits' : 'Show the digits'}
          </button>

          {/*
            Reserved space, so the form does not jump when a message appears —
            the boxes would otherwise move out from under the person's finger
            at the exact moment they are being told to try again.
          */}
          <p role="alert" aria-live="polite"
            className="min-h-[20px] text-[13px] text-[var(--danger)]">
            {error}
          </p>

          <div className="flex flex-col-reverse sm:flex-row gap-2.5">
            <Button variant="secondary" onClick={() => router.back()} className="sm:flex-1">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !complete} className="sm:flex-1">
              <Shield size={16} aria-hidden="true" />
              {saving ? 'Changing…' : 'Change PIN'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
