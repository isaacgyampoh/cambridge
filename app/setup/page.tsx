'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ShieldCheck, Copy, Check, AlertCircle, Loader2 } from 'lucide-react'
import { BRAND } from '@/lib/brand'
import { PIN_LENGTH } from '@/lib/auth/pinPolicy'

/**
 * First-run setup.
 *
 * ── WHAT THIS PAGE IS ──────────────────────────────────────────────────────
 *
 * The browser half of provisioning. The half that needs SETUP_SECRET happens
 * server-side, at /api/setup/open, performed by whoever operates the
 * deployment. This page never asks for a secret, never receives one, and
 * cannot provision anything unless somebody has already opened a window.
 *
 * The previous version was a dark developer console that asked the operator to
 * paste SETUP_SECRET into a text box — a value marked Sensitive in the
 * deployment environment precisely so that nobody can read it. It was a page
 * the person who needed it could never use.
 *
 * ── THE CREDENTIALS ────────────────────────────────────────────────────────
 *
 * Shown exactly once, in the response that creates them. They are never put in
 * the URL, never written to localStorage or a cookie, and there is no endpoint
 * that can be asked for them again. Copying uses the clipboard, which is the
 * operating system's, not this page's storage.
 */

type State = {
  superAdminExists: boolean
  hasSignInPin: boolean
  hasRecoveryPin: boolean
  provisioningIncomplete: boolean
  windowOpen: boolean
  windowAllowsReset: boolean
  windowExpiresIn: number
}

type Credentials = { signInPin: string; recoveryPin: string; email: string; reset: boolean }

export default function SetupPage() {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const read = useCallback(async (): Promise<State | null> => {
    try {
      const res = await fetch('/api/setup/provision')
      return res.ok ? await res.json() : null
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let alive = true
    read().then(s => { if (alive) { setState(s); setLoading(false) } })
    return () => { alive = false }
  }, [read])

  async function provision() {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch('/api/setup/provision', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || 'Setup could not be completed.')
        setState(await read())
        return
      }
      setCredentials(json)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setWorking(false)
    }
  }

  /** Clipboard only — nothing is written to any persistent store. */
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      setError('Could not copy. Write the PIN down instead.')
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-4 py-8 sm:py-14"
      style={{ background: 'var(--canvas)' }}>
      <div className="w-full max-w-[460px]">

        <header className="text-center mb-7">
          <span className="w-16 h-16 rounded-2xl bg-white border border-[var(--line)] grid place-items-center mx-auto mb-4 p-2.5 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logo} alt="" aria-hidden="true" className="w-full h-full object-contain" />
          </span>
          <h1 className="font-display text-[22px] sm:text-[26px] font-semibold text-[var(--ink)] leading-tight">
            {BRAND.name}
          </h1>
          <p className="text-[var(--ink-soft)] text-[14px] mt-1.5">First-time setup</p>
        </header>

        {/* ── the credentials, shown once ─────────────────────────────── */}
        {credentials ? (
          <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-1">
              <ShieldCheck size={20} className="text-[var(--ok)]" aria-hidden="true" />
              <h2 className="font-display text-[18px] font-semibold text-[var(--ink)]">
                {credentials.reset ? 'Super admin reset' : 'Super admin ready'}
              </h2>
            </div>
            <p className="text-[13.5px] text-[var(--ink-soft)] leading-relaxed mb-5">
              These are shown once and cannot be retrieved again. Write them down before
              you continue.
            </p>

            {[
              {
                key: 'signin',
                label: 'Sign-in PIN',
                value: credentials.signInPin,
                note: `Use this to sign in. You will be asked to choose your own ${PIN_LENGTH}-digit PIN straight away.`,
                tone: 'accent' as const,
              },
              {
                key: 'recovery',
                label: 'Recovery PIN',
                value: credentials.recoveryPin,
                note: 'Only for resetting a forgotten PIN. It cannot sign you in on its own. Keep it somewhere separate and safe.',
                tone: 'gold' as const,
              },
            ].map(item => (
              <div key={item.key}
                className={`rounded-xl border p-4 mb-3 ${item.tone === 'accent'
                  ? 'border-[var(--accent)]/25 bg-[var(--accent-soft)]'
                  : 'border-[var(--gold)]/30 bg-[var(--gold-soft)]'}`}>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="text-[12px] font-semibold text-[var(--ink-soft)] uppercase tracking-[0.08em]">
                    {item.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(item.key, item.value)}
                    className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-lg
                      text-[12.5px] font-semibold text-[var(--ink-soft)] hover:bg-black/5 transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                    {copied === item.key
                      ? <><Check size={14} aria-hidden="true" /> Copied</>
                      : <><Copy size={14} aria-hidden="true" /> Copy</>}
                  </button>
                </div>
                <div className={`font-display text-[34px] leading-none font-semibold tracking-[0.32em] tabular-nums
                  ${item.tone === 'accent' ? 'text-[var(--accent)]' : 'text-[var(--gold)]'}`}>
                  {item.value}
                </div>
                <p className="text-[12.5px] text-[var(--ink-soft)] mt-2.5 leading-relaxed">{item.note}</p>
              </div>
            ))}

            <label className="flex items-start gap-3 mt-5 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={saved}
                onChange={e => setSaved(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded accent-[var(--accent)] flex-shrink-0"
              />
              <span className="text-[13.5px] text-[var(--ink)] leading-relaxed">
                I have written down both PINs. I understand they will not be shown again.
              </span>
            </label>

            <Link
              href="/login"
              aria-disabled={!saved}
              onClick={e => { if (!saved) e.preventDefault() }}
              className={`w-full h-12 rounded-xl font-semibold text-[15px] flex items-center justify-center
                transition-all focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
                ${saved
                  ? 'bg-[var(--accent)] text-white hover:brightness-110'
                  : 'bg-[var(--line-soft)] text-[var(--ink-faint)] pointer-events-none'}`}>
              Continue to sign in
            </Link>
          </div>
        ) : (
          /* ── before provisioning ───────────────────────────────────── */
          <div className="bg-[var(--paper)] border border-[var(--line)] rounded-2xl p-5 sm:p-6 shadow-sm">
            {loading ? (
              <div className="flex items-center justify-center gap-2.5 py-10 text-[var(--ink-soft)]">
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                <span className="text-[14px]">Checking this system…</span>
              </div>
            ) : !state ? (
              <div role="alert" className="text-center py-6">
                <AlertCircle size={22} className="text-[var(--danger)] mx-auto mb-3" aria-hidden="true" />
                <p className="text-[14.5px] text-[var(--ink)] font-medium mb-1">Could not reach the system</p>
                <p className="text-[13.5px] text-[var(--ink-soft)]">Check your connection and reload.</p>
              </div>
            ) : state.windowOpen ? (
              <>
                <h2 className="font-display text-[18px] font-semibold text-[var(--ink)] mb-1.5">
                  Ready to set up
                </h2>
                <p className="text-[13.5px] text-[var(--ink-soft)] leading-relaxed mb-5">
                  Setup has been authorised. Pressing the button below creates the super
                  admin sign-in PIN and recovery PIN, and shows them to you once.
                </p>

                {state.superAdminExists && state.hasSignInPin && !state.windowAllowsReset && (
                  <div className="rounded-xl border border-[var(--warn)]/25 bg-[var(--warn-soft)] p-3.5 mb-4">
                    <p className="text-[13px] text-[var(--ink)] leading-relaxed">
                      A super admin already exists. This will add a recovery PIN and issue a
                      fresh sign-in PIN.
                    </p>
                  </div>
                )}

                <button
                  onClick={provision}
                  disabled={working}
                  className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-semibold
                    text-[15px] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none
                    transition-all flex items-center justify-center gap-2
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                    focus-visible:ring-offset-2">
                  {working
                    ? <><Loader2 size={17} className="animate-spin" aria-hidden="true" /> Setting up…</>
                    : 'Create super admin credentials'}
                </button>
              </>
            ) : (
              <>
                <h2 className="font-display text-[18px] font-semibold text-[var(--ink)] mb-1.5">
                  {state.provisioningIncomplete ? 'Setup is not open' : 'This system is set up'}
                </h2>
                <p className="text-[13.5px] text-[var(--ink-soft)] leading-relaxed">
                  {state.provisioningIncomplete
                    ? 'For security, setup has to be authorised on the server before it can run here. Ask whoever manages this deployment to open a setup window, then reload this page.'
                    : 'A super admin is already provisioned. If you have forgotten the PIN, use Forgot PIN on the sign-in screen.'}
                </p>

                <dl className="mt-5 rounded-xl border border-[var(--line)] divide-y divide-[var(--line-soft)] text-[13px]">
                  {[
                    ['Super admin account', state.superAdminExists],
                    ['Sign-in PIN set', state.hasSignInPin],
                    ['Recovery PIN set', state.hasRecoveryPin],
                  ].map(([label, done]) => (
                    <div key={String(label)} className="flex items-center justify-between px-3.5 py-2.5">
                      <dt className="text-[var(--ink-soft)]">{String(label)}</dt>
                      <dd className={done ? 'text-[var(--ok)] font-semibold' : 'text-[var(--ink-faint)]'}>
                        {done ? 'Yes' : 'Not yet'}
                      </dd>
                    </div>
                  ))}
                </dl>

                <Link href="/login"
                  className="mt-5 w-full h-12 rounded-xl border border-[var(--line)] bg-[var(--paper)]
                    text-[var(--ink)] font-semibold text-[15px] flex items-center justify-center
                    hover:bg-[var(--canvas)] transition-colors">
                  Go to sign in
                </Link>
              </>
            )}

            {error && (
              <div role="alert"
                className="mt-4 px-4 py-3 rounded-xl bg-[var(--danger-soft)] border border-[var(--danger)]/15
                  text-[13.5px] text-[var(--danger)] leading-relaxed">
                {error}
              </div>
            )}
          </div>
        )}

        <p className="text-[12px] text-[var(--ink-faint)] text-center mt-6 leading-relaxed">
          Setup is authorised on the server. This page never sees or asks for a
          deployment secret.
        </p>
      </div>
    </div>
  )
}
