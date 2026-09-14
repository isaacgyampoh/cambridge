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
/*
 * Status, stated quietly.
 *
 * Every tone carried a 1px inset ring, which on a small pill reads as a
 * border, and a bordered pill reads as a button — so a list of statuses
 * looked like a row of things to press. The fill alone is enough to separate
 * a status from the text around it.
 *
 * Neutral is the default on purpose: most statuses are not events. Only the
 * three that genuinely need attention — awaiting, overdue, failed — take a
 * colour, and they take a soft one.
 */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
  accent:  'bg-[var(--brand-soft)] text-[var(--accent)]',
  success: 'bg-[var(--brand-soft)] text-[var(--accent)]',
  warning: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  danger:  'bg-[var(--danger-soft)] text-[var(--danger)]',
  muted:   'bg-[var(--line-soft)] text-[var(--ink-faint)]',
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
      className={`inline-flex items-center gap-1.5 font-medium rounded-full whitespace-nowrap ${pad} ${TONE_CLASSES[tone]} ${className}`}
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
/*
 * One family, four depths.
 *
 * These were five semantic colours — accent, success, warning, gold, danger —
 * so a list of people came out as a row of green, amber and red discs. That
 * reads as STATUS: a red avatar looks like a problem with that person, and an
 * amber one looks like a warning, when the colour only ever meant "their name
 * hashes differently from yours".
 *
 * The tints below carry no meaning at all. They vary only enough to make a
 * list scannable, and every one of them belongs to the same green-neutral
 * family, so nothing in a row of people competes with the one green on the
 * screen that does mean something.
 */
const AVATAR_TINTS = [
  // The two green-family entries follow the palette rather than repeating it;
  // they held the pre-lift values and would otherwise have stayed dark after
  // the greens moved.
  'bg-[var(--brand-soft)] text-[var(--accent)]',
  'bg-[#EDF1EF] text-[#4A6B5E]',
  'bg-[#E6EEEB] text-[var(--brand)]',
  'bg-[#F0F3F1] text-[#5A6B64]',
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
  const btn = `h-11 px-4 rounded-2xl border border-[var(--line)] text-[13px] font-semibold
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

/* ─────────────────────────────────────────────
   Where a record has got to
   ───────────────────────────────────────────── */

export type ProgressStep = {
  /** The stage, in the words the office uses. */
  label: string
  /** Extra detail — a date, an amount. Shown under the label. */
  detail?: string
}

/**
 * A record's journey, and how far along it is.
 *
 * ── WHY A COMPONENT AND NOT A BADGE ────────────────────────────────────────
 *
 * A registration passes through five stages, and every screen that showed one
 * showed only the CURRENT stage as a badge. "Awaiting payment" tells you where
 * something is stuck but not what happens next, so the answer to "what is left
 * for this student?" meant knowing the process by heart.
 *
 * Stages already done are filled, the current one is ringed, the rest are
 * outlined. That is three states carried by shape and fill rather than colour
 * alone, so it survives being printed or screenshotted in a support thread.
 *
 * Horizontal on a wide screen; on a phone it becomes a vertical list, because
 * five labels across 375px is five truncated words.
 */
export function ProgressSteps({
  steps, current, className = '',
}: {
  steps: ProgressStep[]
  /** Index of the stage in progress. Use steps.length when everything is done. */
  current: number
  className?: string
}) {
  return (
    <ol className={`flex flex-col sm:flex-row sm:items-start gap-0 sm:gap-1 ${className}`}>
      {steps.map((step, i) => {
        const done = i < current
        const active = i === current
        const last = i === steps.length - 1

        return (
          <li key={step.label}
            className="flex sm:flex-col sm:flex-1 sm:items-center gap-3 sm:gap-2 min-w-0">
            {/* Marker and the rule joining it to the next one. */}
            <div className="flex flex-col sm:flex-row sm:w-full items-center flex-shrink-0">
              <span
                aria-hidden="true"
                className={`w-[18px] h-[18px] rounded-full flex-shrink-0 grid place-items-center
                  border-2 transition-colors
                  ${done
                    ? 'bg-[var(--brand)] border-[var(--brand)]'
                    : active
                      ? 'bg-[var(--paper)] border-[var(--brand)] ring-4 ring-[var(--brand-soft)]'
                      : 'bg-[var(--paper)] border-[var(--line)]'}`}
              >
                {done && (
                  <svg viewBox="0 0 10 8" className="w-[10px] h-[8px]" fill="none">
                    <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>

              {!last && (
                <span aria-hidden="true"
                  className={`w-[2px] h-6 sm:w-full sm:h-[2px] sm:ml-1 flex-shrink-0
                    ${done ? 'bg-[var(--brand)]' : 'bg-[var(--line)]'}`} />
              )}
            </div>

            <div className={`min-w-0 pb-4 sm:pb-0 sm:text-center ${last ? 'pb-0' : ''}`}>
              <div className={`text-[13px] leading-tight truncate sm:whitespace-normal
                ${active ? 'font-semibold text-[var(--ink)]' : done ? 'font-medium text-[var(--ink)]' : 'text-[var(--ink-faint)]'}`}>
                {step.label}
              </div>
              {step.detail && (
                <div className="text-[12px] text-[var(--ink-faint)] mt-0.5 truncate sm:whitespace-normal">
                  {step.detail}
                </div>
              )}
              <span className="sr-only">
                {done ? ' — done' : active ? ' — in progress' : ' — not started'}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
