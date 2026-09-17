'use client'
import { useState } from 'react'
import { Phone, MessageCircle, Copy, Check } from 'lucide-react'
import { telHref, whatsappHref, displayPhone } from '@/lib/ui/contact'

/**
 * The WhatsApp and Call buttons, in one place.
 *
 * ── WHY THESE ARE PLAIN ANCHORS ────────────────────────────────────────────
 *
 * A `tel:` or `wa.me` tap is a NAVIGATION, and the browser only hands a
 * navigation to another application while the user activation from the tap is
 * still live. A handler that does anything asynchronous first — logging the
 * call, awaiting a fetch — has spent that activation by the time it sets
 * window.location, and Android Chrome and iOS Safari drop the hand-off
 * silently. Nothing opens, nothing errors, and whether it works at all comes
 * down to how fast the network answered. That is exactly the "works on some
 * phones" report.
 *
 * So the href does the work. The browser performs the navigation itself, with
 * the activation intact, and anything the application wants to record happens
 * alongside it rather than in front of it.
 *
 * ── WHY WHATSAPP DOES NOT OPEN A NEW TAB ───────────────────────────────────
 *
 * target="_blank" asks for a new browsing context first, and only then for
 * the hand-off. Inside an installed PWA that means the PWA opens a Custom Tab,
 * the Custom Tab loads wa.me, and wa.me then tries to reach WhatsApp — two
 * hops, each of which can be refused by pop-up blocking or by the Custom Tab's
 * own navigation policy. A same-context navigation lets Android match the URL
 * against WhatsApp's App Links filter on the FIRST hop and open the app
 * directly, and Chrome still keeps the PWA intact behind an out-of-scope
 * in-app browser when WhatsApp is not installed.
 *
 * ── AND WHY A BAD NUMBER IS NOT A LINK ─────────────────────────────────────
 *
 * A malformed tel: fails silently on a phone, which is the worst kind of
 * broken. When the number cannot be normalised there is no href at all —
 * the number is shown with a Copy button instead, so the person can still
 * act, and nothing pretends to have worked.
 */

type Tone = 'whatsapp' | 'call'

const BASE =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-[var(--radius-control)] ' +
  'text-[14px] font-semibold transition-colors select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1'

const TONES: Record<Tone, string> = {
  whatsapp: 'bg-[var(--accent-bright)] text-[var(--ink)] hover:brightness-95 focus-visible:ring-[var(--ink)]',
  call: 'bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 focus-visible:ring-[var(--ink)]',
}

/** Shown in place of a link when the number cannot be dialled or messaged. */
function CopyFallback({ phone, label }: { phone: string | null | undefined; label: string }) {
  const [copied, setCopied] = useState(false)
  const shown = displayPhone(phone)

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard permission. The number is on screen either way, which is
      // the point — this is the fallback, not a second thing to fail.
    }
  }

  return (
    <button type="button" onClick={copy}
      className={`${BASE} border border-[var(--line)] bg-[var(--paper)] text-[var(--ink-soft)]`}
      title={`${label} is not available for this number`}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span className="tabular-nums">{copied ? 'Copied' : shown}</span>
    </button>
  )
}

export function WhatsAppAction({
  phone, message, label = 'WhatsApp', className = '', onOpen,
}: {
  phone: string | null | undefined
  message?: string
  label?: string
  className?: string
  /** Fired alongside the navigation. Must not block it. */
  onOpen?: () => void
}) {
  const href = whatsappHref(phone, message)
  if (!href) return <CopyFallback phone={phone} label="WhatsApp" />

  return (
    <a
      href={href}
      /*
       * No target: see the note above. rel is still set because wa.me is a
       * third party and must never receive a window.opener handle.
       */
      rel="noopener noreferrer"
      onClick={() => onOpen?.()}
      className={`${BASE} ${TONES.whatsapp} ${className}`}>
      <MessageCircle size={16} aria-hidden="true" />
      {label}
    </a>
  )
}

export function CallAction({
  phone, label = 'Call', className = '', onOpen,
}: {
  phone: string | null | undefined
  label?: string
  className?: string
  /** Fired alongside the navigation. Must not block it. */
  onOpen?: () => void
}) {
  const href = telHref(phone)
  if (!href) return <CopyFallback phone={phone} label="Calling" />

  return (
    <a
      href={href}
      onClick={() => onOpen?.()}
      className={`${BASE} ${TONES.call} ${className}`}>
      <Phone size={16} aria-hidden="true" />
      {label}
    </a>
  )
}

/**
 * The pair, laid out so neither is ever too small to hit.
 *
 * They share the row evenly and wrap rather than shrinking, because a button
 * squeezed to fit a narrow card is the failure this is meant to prevent.
 */
export function ContactActions({
  phone, message, className = '', onCall, onWhatsApp,
}: {
  phone: string | null | undefined
  message?: string
  className?: string
  onCall?: () => void
  onWhatsApp?: () => void
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <WhatsAppAction phone={phone} message={message} className="flex-1 min-w-[140px]" onOpen={onWhatsApp} />
      <CallAction phone={phone} className="flex-1 min-w-[120px]" onOpen={onCall} />
    </div>
  )
}
