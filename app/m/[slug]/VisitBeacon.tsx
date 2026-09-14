'use client'

import { useEffect, useRef } from 'react'

/**
 * Tells the ERP the page was actually opened by a person.
 *
 * ── WHY THE SESSION VALUE LIVES IN sessionStorage ──────────────────────────
 *
 * It must survive a refresh — otherwise reloading counts as a second
 * visitor — and it must NOT survive the browser being closed, because then it
 * would start to behave like a way of recognising somebody who came back
 * weeks later. sessionStorage is exactly that window: one visit, then gone.
 *
 * Nothing identifying is in it. It is random, it means nothing outside the
 * one table it is written to, and it is never joined to a lead. Somebody who
 * reads the page and leaves has told the centre nothing about themselves, and
 * that is the correct outcome.
 *
 * ── AND WHY IT NEVER SHOWS THE PERSON ANYTHING ─────────────────────────────
 *
 * Renders null and swallows every failure. A visitor came here to read about
 * a programme; a counter that could interrupt that, or block it, or throw an
 * error into the console, has its priorities backwards.
 */
export default function VisitBeacon({ code, courseId }: { code: string; courseId?: string | null }) {
  // Strict Mode mounts effects twice in development. Without this the beacon
  // fires twice, and although the unique index would absorb it, the network
  // tab would suggest a bug that is not there.
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true

    let session: string
    try {
      const KEY = 'cce_m_session'
      session = sessionStorage.getItem(KEY) || ''
      if (!session) {
        session = crypto.randomUUID()
        sessionStorage.setItem(KEY, session)
      }
    } catch {
      // Private browsing, or storage blocked. A visit still counts; it simply
      // cannot be de-duplicated against a refresh.
      session = crypto.randomUUID()
    }

    /*
     * keepalive so the request survives the person tapping "Register" a
     * moment later — which is the visit that matters most, and the one a
     * plain fetch would have cancelled.
     */
    fetch('/api/marketing/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        session,
        courseId: courseId ?? null,
        referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [code, courseId])

  return null
}
