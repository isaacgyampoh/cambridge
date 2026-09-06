'use client'

import React from 'react'
import { ChevronRight } from 'lucide-react'
import { SkeletonList } from './states'
import { ErrorState } from './states'
import { EmptyState } from './index'

/**
 * A list of records, designed for a phone first.
 *
 * ── WHY THIS EXISTS ALONGSIDE DataTable ────────────────────────────────────
 *
 * DataTable renders one description of the data as a table on a pointer and
 * as cards below `sm`. That is right where the columns genuinely matter —
 * comparing figures down a column, scanning a report.
 *
 * It is the wrong shape for the screens people actually live in. A lead is not
 * a row of cells: it is a person with a name, a status, and two things you
 * might do about them right now. Forcing that into columns produces a card
 * that is a stack of "Label: value" pairs, which is a table with extra steps.
 *
 * So this is the other half of the pair. A row here has a shape — identity on
 * the left, state on the right, actions beneath — and it is the same shape at
 * every width. Choose DataTable when the columns are the point, and this when
 * the record is.
 */

export type ListRowProps = {
  /** The person or thing this row is about. */
  title: string
  /** One line beneath the title: a phone number, a programme, a date. */
  subtitle?: React.ReactNode
  /** Leading element — usually an Avatar. */
  leading?: React.ReactNode
  /** Top right — usually a StatusBadge. */
  status?: React.ReactNode
  /** Small facts shown under the subtitle. Keep to three or fewer. */
  meta?: React.ReactNode
  /** Primary actions. Two or three at most; the rest belong in an ActionMenu. */
  actions?: React.ReactNode
  /**
   * A secondary strip below the actions — a snooze control, a link into the
   * record, a progress bar. Kept separate from `meta` because it holds
   * CONTROLS: it is excluded from the row's link and stops propagation, which
   * text never needs to do.
   */
  subrow?: React.ReactNode
  /** Opening the record. Renders the row as a link with a chevron. */
  href?: string
  onClick?: () => void
}

export function ListRow({
  title, subtitle, leading, status, meta, actions, subrow, href, onClick,
}: ListRowProps) {
  const interactive = Boolean(href || onClick)

  const body = (
    <>
      <div className="flex items-start gap-3">
        {leading && <div className="flex-shrink-0 mt-0.5">{leading}</div>}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-[15px] text-[var(--ink)] leading-snug break-words">
              {title}
            </span>
            {status && <span className="flex-shrink-0">{status}</span>}
          </div>

          {subtitle && (
            <div className="text-[13px] text-[var(--ink-soft)] mt-0.5 break-words">{subtitle}</div>
          )}

          {meta && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[12px] text-[var(--ink-faint)]">
              {meta}
            </div>
          )}
        </div>

        {interactive && !actions && (
          <ChevronRight size={17} aria-hidden="true"
            className="text-[var(--ink-faint)] flex-shrink-0 mt-1" />
        )}
      </div>

      {actions && (
        // Actions sit on their own row so they get full-width targets rather
        // than being squeezed beside the text. stopPropagation because the
        // whole card is usually a link, and tapping "Call" must not also
        // navigate.
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--line-soft)]"
          onClick={e => { e.stopPropagation(); e.preventDefault() }}>
          {actions}
        </div>
      )}

      {subrow && (
        <div className={actions ? 'mt-2' : 'mt-3 pt-3 border-t border-[var(--line-soft)]'}
          onClick={e => { e.stopPropagation(); e.preventDefault() }}>
          {subrow}
        </div>
      )}
    </>
  )

  const shell = `block w-full text-left bg-[var(--paper)] border border-[var(--line)]
    rounded-xl p-4 transition-colors
    ${interactive ? 'hover:border-[var(--ink-faint)] active:bg-[var(--canvas)]' : ''}
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`

  if (href) return <a href={href} className={shell}>{body}</a>
  if (onClick) return <button type="button" onClick={onClick} className={shell}>{body}</button>
  return <div className={shell}>{body}</div>
}

/**
 * The list itself, with its own loading, empty and error states.
 *
 * Those three live here rather than in each screen for the reason the audit
 * found: thirty-seven screens rendered a failed load as an empty list, so a
 * permissions refusal looked exactly like "you have no leads". A list that
 * owns all three states cannot make that mistake.
 */
export function MobileList<T>({
  rows, rowKey, renderRow, state = 'ready', onRetry,
  emptyTitle = 'Nothing here yet', emptyMessage, emptyAction,
  errorTitle, errorMessage, skeletonRows = 5, className = '',
}: {
  rows: T[]
  rowKey: (row: T) => string
  renderRow: (row: T) => React.ReactNode
  state?: 'loading' | 'ready' | 'error'
  onRetry?: () => void
  emptyTitle?: string
  emptyMessage?: string
  emptyAction?: React.ReactNode
  errorTitle?: string
  errorMessage?: string
  skeletonRows?: number
  className?: string
}) {
  if (state === 'loading') {
    return <div className={className}><SkeletonList rows={skeletonRows} /></div>
  }

  if (state === 'error') {
    return (
      <div className={className}>
        <ErrorState
          title={errorTitle || 'That did not load'}
          message={errorMessage || 'Something went wrong on our side. Please try again.'}
          onRetry={onRetry}
        />
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className={className}>
        <EmptyState title={emptyTitle} description={emptyMessage} action={emptyAction} />
      </div>
    )
  }

  return (
    <ul className={`space-y-2.5 stagger ${className}`}>
      {rows.map(row => (
        <li key={rowKey(row)}>{renderRow(row)}</li>
      ))}
    </ul>
  )
}

/**
 * A compact action for a ListRow: "Call", "WhatsApp", "Follow up".
 *
 * Equal width by default so a row of them fills the card evenly, and 42px
 * tall so it clears the touch minimum without dominating the card.
 */
export function RowAction({
  label, onClick, href, icon, tone = 'default', external,
}: {
  label: string
  onClick?: () => void
  href?: string
  icon?: React.ReactNode
  tone?: 'default' | 'accent' | 'success'
  /** Opens in a new tab — used for WhatsApp's web handoff. */
  external?: boolean
}) {
  const tones = {
    default: 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-faint)] hover:text-[var(--ink)]',
    accent:  'border-[var(--accent)]/25 text-[var(--accent)] hover:bg-[var(--accent-soft)]',
    success: 'border-[var(--ok)]/25 text-[var(--ok)] hover:bg-[var(--ok-soft)]',
  }
  const cls = `flex-1 inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3
    rounded-2xl border bg-[var(--paper)] text-[13px] font-semibold transition-colors
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
    ${tones[tone]}`

  if (href) {
    return (
      <a href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={cls}>
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </button>
  )
}
