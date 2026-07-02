'use client'
import { useState } from 'react'

/**
 * Tap-to-call: logs the contact in the system, then opens the phone's dialer
 * with the lead's number (so the call goes out on the staff member's own
 * line/number). Auto-marks a new lead as 'contacted'.
 */
export default function CallButton({
  leadId, phone, onLogged, className = '',
}: {
  leadId: string
  phone: string
  onLogged?: (newStatus?: string) => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)

  async function call() {
    if (busy) return
    setBusy(true)
    // Log first (fire but don't block the dialer for long)
    try {
      const res = await fetch('/api/leads/log-call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      })
      const d = await res.json().catch(() => ({}))
      onLogged?.(d.status)
    } catch {}
    setBusy(false)
    // Open the dialer
    window.location.href = `tel:${phone}`
  }

  return (
    <button onClick={call} disabled={busy}
      className={className || 'flex items-center gap-1.5 px-4 py-2 bg-[var(--ok)] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition disabled:opacity-60'}>
      {busy ? 'Logging…' : 'Call'}
    </button>
  )
}
