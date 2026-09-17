'use client'
import { Phone } from 'lucide-react'
import { telHref, displayPhone } from '@/lib/ui/contact'
import { useState } from 'react'

/**
 * Tap-to-call: opens the phone's dialler, and logs the contact alongside.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * This was a <button> whose handler did:
 *
 *     setBusy(true)
 *     await fetch('/api/leads/log-call', …)     // a network round trip
 *     setBusy(false)
 *     window.location.href = `tel:${phone}`
 *
 * Two independent faults, and between them they explain why the Call button
 * worked on some phones and not others.
 *
 * 1. THE NAVIGATION CAME AFTER AN AWAIT. A browser hands a tel: URL to the
 *    dialler only while the user activation from the tap is still live. That
 *    activation does not survive a network round trip, so by the time
 *    window.location was set the browser had already decided this was not a
 *    user-initiated navigation and dropped it — silently, with no error. On a
 *    fast connection the round trip sometimes finished inside the window and
 *    it worked; on a slower one it never did. Same build, same code,
 *    different outcome per phone and per network, which is exactly the report.
 *
 * 2. THE NUMBER WAS NOT NORMALISED. `tel:${phone}` used the stored string. A
 *    number held as "+233 24 123 4567" produced "tel:+233 24 123 4567", and
 *    a tel: URI containing spaces is rejected or mangled by several Android
 *    diallers.
 *
 * The button was also disabled={busy} for the duration, so a second tap
 * during the fetch did nothing at all.
 *
 * ── WHAT IT DOES NOW ───────────────────────────────────────────────────────
 *
 * It is an anchor with a normalised href, so the BROWSER performs the
 * navigation with the activation intact and the dialler opens on the first
 * tap. The log is sent alongside with keepalive, which is what keepalive is
 * for: a request that must outlive the page it was sent from.
 */
export default function CallButton({
  leadId, phone, onLogged, className = '',
}: {
  leadId: string
  phone: string
  onLogged?: (newStatus?: string) => void
  className?: string
}) {
  const href = telHref(phone)
  const [copied, setCopied] = useState(false)

  /*
   * Deliberately NOT awaited, and deliberately not preventing the default.
   * The navigation is the job; this is a note about it.
   */
  function log() {
    try {
      fetch('/api/leads/log-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
        // Survives the page being handed to the dialler.
        keepalive: true,
      })
        .then(r => r.json())
        .then(d => onLogged?.(d?.status))
        .catch(() => { /* the call still happens; the log is secondary */ })
    } catch { /* never let logging cost the call */ }
  }

  const base = className ||
    'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 bg-[var(--ok)] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition'

  /*
   * No usable number: show it with a copy action rather than a link that
   * fails silently when tapped.
   */
  if (!href) {
    return (
      <button type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(displayPhone(phone))
            setCopied(true); setTimeout(() => setCopied(false), 2000)
          } catch { /* the number is on screen regardless */ }
        }}
        className={className || 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 border border-[var(--line)] text-[var(--ink-soft)] rounded-xl text-sm font-semibold'}>
        {copied ? 'Copied' : displayPhone(phone)}
      </button>
    )
  }

  return (
    <a href={href} onClick={log} className={base}>
      <Phone size={15} aria-hidden="true" />
      Call
    </a>
  )
}
