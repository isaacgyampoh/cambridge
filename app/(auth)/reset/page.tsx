'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button, Field, inputClass } from '@/components/ui'
import { PIN_LENGTH } from '@/lib/auth/pinPolicy'
import { BRAND } from '@/lib/brand'

/**
 * SETTING YOUR OWN PIN, FROM A LINK AN ADMINISTRATOR SENT.
 *
 * ── WHY THIS PAGE EXISTS ───────────────────────────────────────────────────
 *
 * A reset used to mean an administrator typed a PIN, the system wrote it to
 * the account, and the PIN itself went out in a text. Whoever picked up that
 * phone had a working credential — one that stayed working, and could be
 * forwarded.
 *
 * The link that leads here is a single-use token instead: it authorises
 * choosing a PIN once, it expires within the hour, and it is spent the moment
 * it is used. The person's own PIN is never known to anybody else, including
 * the administrator who started the reset.
 *
 * It posts to the recovery endpoint that already existed for people who
 * recover their own accounts — the same single-use check, the same rate
 * limit, the same refusal of a PIN another account is already using. One path
 * through the auth code, not a second one written beside it.
 */

function ResetForm() {
  const token = useSearchParams().get('t') || ''
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pin.length !== PIN_LENGTH) { toast.error(`Your PIN must be exactly ${PIN_LENGTH} digits`); return }
    if (pin !== confirm) { toast.error('Those PINs do not match'); return }

    setBusy(true)
    try {
      const d = await fetch('/api/auth/recover/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken: token, newPin: pin }),
      }).then(r => r.json())
      if (!d.success) { toast.error(d.error || 'That did not work. Ask for a new link.'); return }
      setDone(true)
    } catch {
      toast.error('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed">
        This link is incomplete. Open the one you were sent in full, or ask your administrator to send it again.
      </p>
    )
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--ink)] leading-relaxed">
          Your PIN is set. Sign in with it — you will be sent a code by text to finish.
        </p>
        <Link href="/login">
          <Button className="w-full">Go to sign in</Button>
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed">
        Choose a PIN of {PIN_LENGTH} digits. Nobody else is told what you choose, including whoever
        started the reset. This link stops working once you have used it.
      </p>

      <Field label="New PIN">
        <input
          className={inputClass} type="password" inputMode="numeric" autoComplete="new-password"
          maxLength={PIN_LENGTH} value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          aria-label="Your new PIN" autoFocus
        />
      </Field>

      <Field label="Type it again">
        <input
          className={inputClass} type="password" inputMode="numeric" autoComplete="new-password"
          maxLength={PIN_LENGTH} value={confirm}
          onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))}
          aria-label="Your new PIN again"
        />
      </Field>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Setting it…' : 'Set my PIN'}
      </Button>
    </form>
  )
}

export default function ResetPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-[var(--canvas)]">
      <div className="w-full max-w-sm bg-[var(--paper)] border border-[var(--line)] rounded-2xl p-6 sm:p-7">
        <h1 className="font-display text-[20px] font-semibold text-[var(--ink)] mb-1">
          Set your {BRAND.shortName} PIN
        </h1>
        <p className="text-[13px] text-[var(--ink-faint)] mb-5">This link works once.</p>
        <Suspense fallback={<p className="text-[13px] text-[var(--ink-faint)]">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  )
}
