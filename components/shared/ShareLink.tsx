'use client'

import { useState } from 'react'
import { Copy, Check, Share2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

/**
 * A link somebody owns, with the three things they do with it.
 *
 * ── WHY THIS IS A COMPONENT ────────────────────────────────────────────────
 *
 * A marketer's personal links are the core of how this centre gets students,
 * and they appear in several places — the registration link, the referral
 * link, a flyer's link. Each had been written out by hand with its own copy
 * button, its own layout and, in one case, WhatsApp's own brand green
 * hardcoded as #25D366.
 *
 * ── SHARING ON A PHONE ─────────────────────────────────────────────────────
 *
 * Share opens the operating system's own share sheet, so the link goes to
 * WhatsApp, Messenger, SMS or anywhere else the person already uses, in one
 * tap. That is both simpler and more honest than a single WhatsApp button:
 * the product should not decide which app somebody shares in.
 *
 * navigator.share does not exist on most desktop browsers, so the control
 * falls back to copying. It is never shown as a dead button.
 */
export function ShareLink({
  url, label, hint, shareText,
}: {
  url: string
  /** What this link IS — "Your registration link". */
  label: string
  /** What it does, in a sentence. */
  hint?: string
  /** The message that accompanies the link in a share sheet. */
  shareText?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied')
      // Long enough to read, short enough that the button is ready again.
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Press and hold the link to copy it.')
    }
  }

  async function share() {
    // Feature-detected at click time, not at render: a browser can expose
    // navigator.share and still refuse a given payload.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: label, text: shareText, url })
        return
      } catch {
        // A cancelled share sheet lands here too. Falling through to copy
        // would be wrong — the person chose not to share.
        return
      }
    }
    copy()
  }

  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.share)

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
      <p className="text-[13px] font-semibold text-[var(--ink)]">{label}</p>
      {hint && <p className="t-sub mt-1 leading-relaxed">{hint}</p>}

      {/*
        The link itself, selectable. Rendered small and monospaced so a long
        URL does not shout, and break-all so it wraps rather than overflowing
        a 320px screen.
      */}
      <p className="mt-3 rounded-xl bg-[var(--canvas)] border border-[var(--line)]
        px-3.5 py-3 font-mono text-[12px] leading-relaxed text-[var(--ink-soft)] break-all
        select-all">
        {url}
      </p>

      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={copy}
          className="inline-flex items-center justify-center gap-2 flex-1 h-11 rounded-xl
            bg-[var(--accent)] text-[var(--accent-ink)] text-[14px] font-semibold
            hover:bg-[var(--accent-hover)] transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
            focus-visible:ring-offset-2">
          {copied
            ? <><Check size={16} aria-hidden="true" /> Copied</>
            : <><Copy size={16} aria-hidden="true" /> Copy link</>}
        </button>

        {canShare && (
          <button type="button" onClick={share}
            className="inline-flex items-center justify-center gap-2 flex-1 h-11 rounded-xl
              border border-[var(--line)] bg-[var(--paper)] text-[var(--ink)]
              text-[14px] font-semibold hover:bg-[var(--canvas)] transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            <Share2 size={16} aria-hidden="true" /> Share
          </button>
        )}

        <a href={url} target="_blank" rel="noopener noreferrer"
          aria-label={`Open ${label} in a new tab`}
          className="w-11 h-11 grid place-items-center rounded-xl flex-shrink-0
            border border-[var(--line)] text-[var(--ink-soft)]
            hover:bg-[var(--canvas)] transition-colors">
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
