'use client'

import { useState } from 'react'

/**
 * "Want more information?"
 *
 * ── WHY THIS IS NOT A LINK TO A CONTACT PAGE ───────────────────────────────
 *
 * Most people opening a campaign link from WhatsApp have not decided to
 * enrol. They want to know when it starts, or whether they can pay in
 * instalments. Sending those people into a registration and payment form is
 * how a campaign produces nothing from everybody who was merely interested.
 *
 * Three fields, on the page they are already on. A name and a number is
 * enough for a marketer to ring somebody; asking for more at this point costs
 * more leads than the extra detail is worth.
 *
 * ── AND WHY THE NUMBER IS ASKED FOR ────────────────────────────────────────
 *
 * Opening a link tells the centre that somebody was interested, not who they
 * are. A click is not a person. The phone number is typed in, deliberately,
 * by somebody who wants to be called back — which is the only basis on which
 * the centre should have it.
 */
export default function EnquiryForm({
  code, programme, marketerName,
}: {
  code: string
  programme: string | null
  marketerName: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/marketing/enquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, full_name: name, phone, programme, message: message || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || 'That did not go through. Please try again.')
        return
      }
      setDone(d.contactName || marketerName)
    } catch {
      setError('That did not go through. Please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5 text-center">
        <p className="text-[15px] font-semibold text-[var(--ink)]">Thank you — we have your details.</p>
        <p className="mt-1.5 text-[14px] text-[var(--ink-soft)]">
          {done} will call you about {programme || 'the programme'} shortly.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full min-h-[52px] rounded-lg border border-[var(--ink)] px-6 py-3.5
          text-[15px] font-semibold text-[var(--ink)] transition-colors
          hover:bg-[var(--ink)] hover:text-[var(--paper)]">
        Want more information?
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-5">
      <p className="text-[15px] font-semibold text-[var(--ink)]">
        Ask about {programme || 'our programmes'}
      </p>
      <p className="mt-1 text-[13px] text-[var(--ink-soft)]">
        Leave your number and {marketerName} will call you back.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="enq-name" className="block text-[13px] font-medium text-[var(--ink)]">
            Your name
          </label>
          <input
            id="enq-name" value={name} onChange={e => setName(e.target.value)}
            required autoComplete="name" enterKeyHint="next"
            className="mt-1 w-full min-h-[48px] rounded-lg border border-[var(--line)]
              bg-[var(--canvas)] px-3.5 text-[16px] text-[var(--ink)]" />
        </div>

        <div>
          <label htmlFor="enq-phone" className="block text-[13px] font-medium text-[var(--ink)]">
            Phone number
          </label>
          {/*
            type="tel" and inputMode numeric so a phone shows the number pad.
            16px, because anything smaller makes iOS Safari zoom the page on
            focus and the person loses their place in the form.
          */}
          <input
            id="enq-phone" value={phone} onChange={e => setPhone(e.target.value)}
            required type="tel" inputMode="tel" autoComplete="tel"
            placeholder="0201234567" enterKeyHint="next"
            className="mt-1 w-full min-h-[48px] rounded-lg border border-[var(--line)]
              bg-[var(--canvas)] px-3.5 text-[16px] text-[var(--ink)]" />
        </div>

        <div>
          <label htmlFor="enq-msg" className="block text-[13px] font-medium text-[var(--ink)]">
            Your question <span className="text-[var(--ink-faint)] font-normal">(optional)</span>
          </label>
          <textarea
            id="enq-msg" value={message} onChange={e => setMessage(e.target.value)}
            rows={3} enterKeyHint="send"
            placeholder="When does the next class start?"
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--canvas)]
              px-3.5 py-2.5 text-[16px] text-[var(--ink)] resize-y" />
        </div>
      </div>

      {error && <p className="mt-3 text-[13px] text-[var(--bad)]">{error}</p>}

      <button
        type="submit" disabled={busy}
        className="mt-4 w-full min-h-[52px] rounded-lg bg-[var(--ink)] px-6 py-3.5
          text-[15px] font-semibold text-[var(--paper)] disabled:opacity-60">
        {busy ? 'Sending…' : 'Send my details'}
      </button>
    </form>
  )
}
