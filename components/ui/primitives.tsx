'use client'

import React from 'react'
import { describeStatus, type StatusDomain, type Tone } from '@/lib/ui/status'

/**
 * The atoms of the design system.
 *
 * Everything here exists because screens were otherwise inventing it: an
 * icon button was a bare <button> with ad-hoc padding on one screen and a
 * 28px tap target on another, an avatar was initials in a div with whatever
 * background the author liked that day.
 *
 * The rule these encode is that spacing, radii, tone and touch size are
 * decided ONCE. A screen chooses meaning — "this is a destructive action",
 * "this is a lead status" — and the system decides how that looks.
 */

/* ─────────────────────────────────────────────
   Tone → classes, in one place
   ───────────────────────────────────────────── */

/**
 * The single tone table. Badge, StatusBadge and anything else tinted read
 * from this, so a "warning" is the same colour wherever it appears.
 */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)]',
  accent:  'bg-[var(--accent-soft)] text-[var(--accent)] ring-[var(--accent)]/15',
  success: 'bg-[var(--ok-soft)] text-[var(--ok)] ring-[var(--ok)]/15',
  warning: 'bg-[var(--warn-soft)] text-[var(--warn)] ring-[var(--warn)]/15',
  danger:  'bg-[var(--danger-soft)] text-[var(--danger)] ring-[var(--danger)]/15',
  muted:   'bg-[var(--line-soft)] text-[var(--ink-faint)] ring-[var(--line)]',
}

/** A small solid dot in the tone's colour, for dense rows where a pill is too heavy. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-[var(--ink-faint)]',
  accent:  'bg-[var(--accent)]',
  success: 'bg-[var(--ok)]',
  warning: 'bg-[var(--warn)]',
  danger:  'bg-[var(--danger)]',
  muted:   'bg-[var(--line)]',
}

/* ─────────────────────────────────────────────
   StatusBadge
   ───────────────────────────────────────────── */

/**
 * A status, rendered from the shared vocabulary.
 *
 * The caller passes the raw database value and the domain it belongs to —
 * never a label and never a colour. That is deliberate: it is not possible to
 * use this component and still call the same class mode "Online" here and
 * "Virtual" there, which is the drift that put a physical admission letter in
 * an online student's hands.
 *
 * The hint is attached as a title so the meaning is available on hover and to
 * assistive technology, without spending a line of screen on it.
 */
export function StatusBadge({
  domain, value, size = 'md', showDot = false, className = '',
}: {
  domain: StatusDomain
  value: unknown
  size?: 'sm' | 'md'
  /** Show a coloured dot as well as the tint — useful in dense lists. */
  showDot?: boolean
  className?: string
}) {
  const { label, tone, hint } = describeStatus(domain, value)
  const pad = size === 'sm' ? 'text-[11px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'

  return (
    <span
      title={hint}
      className={`inline-flex items-center gap-1.5 font-medium rounded-lg ring-1 ring-inset whitespace-nowrap ${pad} ${TONE_CLASSES[tone]} ${className}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT[tone]}`} aria-hidden="true" />}
      {label}
    </span>
  )
}

/* ─────────────────────────────────────────────
   IconButton
   ───────────────────────────────────────────── */

/**
 * An icon-only control.
 *
 * `label` is required and is not decoration: an icon with no accessible name
 * is unusable with a screen reader, and these were previously bare buttons
 * containing an SVG and nothing else.
 *
 * The smallest size is still 40px square. Anything under about 44 is a
 * coin-toss on a phone, and most people using this product are on one.
 */
export function IconButton({
  label, onClick, children, tone = 'default', size = 'md', disabled, href, className = '',
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  tone?: 'default' | 'accent' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  href?: string
  className?: string
}) {
  const box = size === 'sm' ? 'w-10 h-10' : 'w-11 h-11'
  const tones = {
    default: 'text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]',
    accent:  'text-[var(--accent)] hover:bg-[var(--accent-soft)]',
    danger:  'text-[var(--danger)] hover:bg-[var(--danger-soft)]',
  }
  const cls = `inline-flex items-center justify-center rounded-xl transition-colors flex-shrink-0
    disabled:opacity-40 disabled:pointer-events-none
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1
    ${box} ${tones[tone]} ${className}`

  if (href) {
    return (
      <a href={href} aria-label={label} title={label} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      aria-label={label} title={label} className={cls}>
      {children}
    </button>
  )
}

/* ─────────────────────────────────────────────
   Avatar
   ───────────────────────────────────────────── */

/**
 * Initials, coloured deterministically from the name.
 *
 * Deterministic so the same person is the same colour on every screen and in
 * every session — a small thing that makes a list scannable, and impossible if
 * the colour is random or index-based.
 */
const AVATAR_TINTS = [
  'bg-[var(--accent-soft)] text-[var(--accent)]',
  'bg-[var(--ok-soft)] text-[var(--ok)]',
  'bg-[var(--warn-soft)] text-[var(--warn)]',
  'bg-[var(--gold-soft)] text-[var(--gold)]',
  'bg-[var(--danger-soft)] text-[var(--danger)]',
]

export function initialsOf(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({
  name, size = 'md', src, className = '',
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  src?: string | null
  className?: string
}) {
  const boxes = {
    sm: 'w-8 h-8 text-[11px]',
    md: 'w-10 h-10 text-[13px]',
    lg: 'w-14 h-14 text-[17px]',
  }
  // Sum of char codes: stable across reloads and devices, unlike Math.random
  // or a list index, which would recolour people as a list is filtered.
  const tint = AVATAR_TINTS[
    [...String(name || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TINTS.length
  ]

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" aria-hidden="true"
        className={`${boxes[size]} rounded-full object-cover flex-shrink-0 ${className}`} />
    )
  }
  return (
    <span aria-hidden="true"
      className={`${boxes[size]} ${tint} rounded-full inline-flex items-center justify-center font-semibold flex-shrink-0 select-none ${className}`}>
      {initialsOf(name)}
    </span>
  )
}

/* ─────────────────────────────────────────────
   SectionHeader
   ───────────────────────────────────────────── */

/**
 * A heading inside a page, distinct from PageHeader which titles the page.
 *
 * It renders a real <h2>, so a screen has a heading outline rather than a
 * sequence of styled divs that a screen reader cannot navigate.
 */
export function SectionHeader({
  title, description, action, count, className = '',
}: {
  title: string
  description?: string
  action?: React.ReactNode
  /** Shown beside the title — "Leads 24" reads better than a separate line. */
  count?: number
  className?: string
}) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="font-display text-[15px] sm:text-[17px] font-semibold text-[var(--ink)] flex items-center gap-2">
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="text-[12px] font-semibold text-[var(--ink-faint)] tabular-nums flex-shrink-0">
              {count}
            </span>
          )}
        </h2>
        {description && (
          <p className="text-[13px] text-[var(--ink-soft)] mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

/* ─────────────────────────────────────────────
   LoadingState
   ───────────────────────────────────────────── */

/**
 * A spinner with a reason.
 *
 * Used where a skeleton would be dishonest — a form being submitted, a
 * document being generated — because there is no content shape to imitate.
 * Pretending a form is "loading" with a skeleton of itself tells the user
 * nothing about what is actually happening.
 */
export function LoadingState({
  message = 'Loading…', inline = false,
}: {
  message?: string
  inline?: boolean
}) {
  return (
    <div role="status" aria-live="polite"
      className={inline
        ? 'inline-flex items-center gap-2 text-[13px] text-[var(--ink-soft)]'
        : 'flex flex-col items-center justify-center gap-3 py-16 text-center'}>
      <span className={`${inline ? 'w-4 h-4' : 'w-6 h-6'} border-2 border-[var(--accent)] border-t-transparent rounded-full spin flex-shrink-0`} />
      <span className={inline ? '' : 'text-[14px] text-[var(--ink-soft)]'}>{message}</span>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Pagination
   ───────────────────────────────────────────── */

/**
 * Page controls sized for a thumb.
 *
 * Deliberately not a numbered page list: on a 320px screen a row of page
 * numbers is a line of 20px targets nobody can hit. Previous / position /
 * next, with the range spelled out, does the same job and fits.
 */
export function Pagination({
  page, pageSize, total, onChange, className = '',
}: {
  /** 1-based. */
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  className?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const btn = `h-11 px-4 rounded-xl border border-[var(--line)] text-[13px] font-semibold
    text-[var(--ink-soft)] bg-[var(--paper)] transition-colors
    hover:border-[var(--ink-faint)] disabled:opacity-40 disabled:pointer-events-none
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`

  return (
    <nav aria-label="Pagination"
      className={`flex items-center justify-between gap-3 mt-4 ${className}`}>
      <button type="button" className={btn} onClick={() => onChange(page - 1)} disabled={page <= 1}>
        Previous
      </button>
      <span className="text-[12px] text-[var(--ink-soft)] tabular-nums text-center" aria-live="polite">
        {from}–{to} of {total}
      </span>
      <button type="button" className={btn} onClick={() => onChange(page + 1)} disabled={page >= pages}>
        Next
      </button>
    </nav>
  )
}
