'use client'
import { useEffect, useRef, useState, Suspense } from 'react'
import { KeyRound } from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'

function Enter() {
  const params = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState('')

  /*
   * The token is read during render, not synchronised in an effect.
   *
   * A link arriving without `?t=` is a fact about the URL, so it needs no
   * effect and no state: `incomplete` below is derived. Reading it here also
   * turns the effect's dependency into a plain string, so the redemption no
   * longer re-runs when useSearchParams hands back a new object for the same
   * URL.
   */
  const t = params.get('t')
  const incomplete = !t

  /*
   * Redeemed once, whatever React does with this effect.
   *
   * The token is genuinely single-use: /api/student/auth claims it with a
   * conditional UPDATE on token_used, so the SECOND POST of a link that just
   * worked comes back 401 "already been used". This effect ran the redemption
   * directly, so a re-run — StrictMode's double-invoke in development being
   * the one that happens every time — would send a student who had in fact
   * just signed in straight to the failure screen, holding a valid session
   * cookie with nothing on the page to suggest it.
   *
   * A ref rather than state because nothing renders from it and it has to be
   * true before the second invocation reads it, in the same tick.
   */
  const redeemed = useRef(false)

  useEffect(() => {
    if (!t || redeemed.current) return
    redeemed.current = true

    fetch('/api/student/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t }),
    }).then(r => r.json()).then(d => {
      if (d.success) router.replace('/portal')
      else setError(d.error || 'That link is no longer valid.')
    }).catch(() => setError('Something went wrong. Please try again.'))
  }, [t, router])

  const message = incomplete
    ? 'This link is incomplete. Please use the link sent to you on WhatsApp.'
    : error

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#fafbfc', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        {!message ? (
          <>
            <div style={{ width: 40, height: 40, border: '3px solid #dbe9eb', borderTopColor: 'var(--accent)', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: 'var(--ink-soft)', fontSize: 15 }}>Signing you in…</p>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-soft)] grid place-items-center mx-auto mb-3">
              <KeyRound size={22} className="text-[var(--accent)]" aria-hidden="true" />
            </div>
            <h1 style={{ fontSize: 19, color: 'var(--ink)', marginBottom: 8 }}>{incomplete ? 'Incomplete link' : 'Link expired'}</h1>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{message}</p>
            <a href="/portal/login" style={{ display: 'inline-block', background: 'var(--accent)', color: '#fff', textDecoration: 'none', padding: '12px 22px', borderRadius: 10, fontWeight: 600, fontSize: 14 }}>Get a new link</a>
          </>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  return <Suspense><Enter /></Suspense>
}
