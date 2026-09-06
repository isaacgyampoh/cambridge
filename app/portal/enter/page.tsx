'use client'
import { useEffect, useState, Suspense } from 'react'
import { KeyRound } from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'

function Enter() {
  const params = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    const t = params.get('t')
    if (!t) { setError('This link is incomplete. Please use the link sent to you on WhatsApp.'); return }
    fetch('/api/student/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t }),
    }).then(r => r.json()).then(d => {
      if (d.success) router.replace('/portal')
      else setError(d.error || 'That link is no longer valid.')
    }).catch(() => setError('Something went wrong. Please try again.'))
  }, [params, router])

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#fafbfc', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        {!error ? (
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
            <h1 style={{ fontSize: 19, color: 'var(--ink)', marginBottom: 8 }}>Link expired</h1>
            <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{error}</p>
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
