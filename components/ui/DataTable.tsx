'use client'

import React from 'react'
import { SkeletonList, ErrorState } from '@/components/ui/states'
import { EmptyState } from '@/components/ui'

/**
 * A table on a desktop, cards on a phone.
 *
 * Twenty-one screens render a `<table>` inside `overflow-x-auto`, which on a
 * 375px screen means a staff member drags a six-column grid sideways to read
 * one lead. Horizontal scrolling is the fallback you reach for when there is
 * no time to think about small screens — it is not a mobile layout.
 *
 * The same data, described once, rendered two ways:
 *
 *   ≥ sm   a real semantic <table>, which is what a pointer and a wide screen
 *          want, and what screen readers navigate best
 *   < sm   one card per row: `primary` as the heading, `secondary` beneath it,
 *          and the remaining columns as label/value pairs
 *
 * Loading, empty and error are handled here too, so every list in the app gets
 * the same three states without each page reinventing them.
 */

export type Column<T> = {
  /** Stable key, also used as the React key for the cell. */
  key: string
  header: string
  /** Cell contents. Given the whole row so it can combine fields. */
  render: (row: T) => React.ReactNode
  /** On a phone this becomes the card's heading. Exactly one column should set it. */
  primary?: boolean
  /** On a phone this sits under the heading, unlabelled. */
  secondary?: boolean
  /** Kept out of the card entirely — for columns that only make sense in a grid. */
  hideOnMobile?: boolean
  /** Right-align in the table. Use for money and counts. */
  numeric?: boolean
}

export type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  state?: 'loading' | 'ready' | 'error'
  onRetry?: () => void
  /** Whole-row action. Renders as a button on mobile so the card is tappable. */
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyMessage?: string
  emptyAction?: React.ReactNode
  /** Announced to screen readers, and used in the loading label. */
  caption: string
  /**
   * Which rows need somebody to act.
   *
   * ── WHY A ROW AND NOT A BADGE ────────────────────────────────────────────
   *
   * A table where one row has failed and forty have not looks, at a glance,
   * exactly like a table where none has. The difference is a word in a column
   * somebody has to read across to reach — so the rows that need work are
   * found by reading every row, which is the same as not finding them.
   *
   * Tinting the row moves that from reading to noticing.
   *
   * It is a tint, not a fill: the text stays --ink on a very pale ground, so
   * it is as legible as any other row. And it is deliberately NOT the danger
   * colour — a queue that needs a look is not a failure, and a table that
   * cries error at routine work teaches people to ignore the colour.
   */
  needsAttention?: (row: T) => boolean
}

export function DataTable<T>({
  columns, rows, rowKey, state = 'ready', onRetry, onRowClick,
  emptyTitle = 'Nothing here yet',
  emptyMessage = 'When there is something to show, it will appear here.',
  emptyAction, caption, needsAttention,
}: DataTableProps<T>) {
  if (state === 'loading') return <SkeletonList rows={6} />

  if (state === 'error') {
    return (
      <ErrorState
        title={`Could not load ${caption.toLowerCase()}`}
        message="The list did not come back. Check your connection and try again."
        onRetry={onRetry}
      />
    )
  }

  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyMessage} action={emptyAction} />
  }

  const primary = columns.find(c => c.primary) ?? columns[0]
  const secondary = columns.find(c => c.secondary)
  // Everything else becomes a labelled pair on the card.
  const details = columns.filter(
    c => c !== primary && c !== secondary && !c.hideOnMobile
  )

  return (
    <>
      {/* ── Phone: one card per row ─────────────────────────────── */}
      <ul className="sm:hidden space-y-2.5" aria-label={caption}>
        {rows.map(row => {
          const body = (
            <>
              <div className="font-semibold text-[15px] text-[var(--ink)] leading-snug">
                {primary.render(row)}
              </div>
              {secondary && (
                <div className="text-[13px] text-[var(--ink-soft)] mt-0.5">
                  {secondary.render(row)}
                </div>
              )}
              {details.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                  {details.map(col => (
                    <div key={col.key} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">
                        {col.header}
                      </dt>
                      <dd className="text-[13px] text-[var(--ink)] mt-0.5 truncate">
                        {col.render(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )

          const flagged = needsAttention?.(row) ?? false
          // The tint replaces the surface, so it must not also be hovered to
          // the ordinary canvas — that would wash the signal out on touch.
          const surface = flagged
            ? 'bg-[var(--attention-soft)] border-[var(--attention)]/25'
            : 'bg-[var(--paper)] border-[var(--line)]'

          return (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button onClick={() => onRowClick(row)}
                  className={`w-full text-left rounded-2xl border p-4 min-h-[44px] transition-colors
                    ${surface} ${flagged ? '' : 'hover:bg-[var(--canvas)]'}
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}>
                  {body}
                </button>
              ) : (
                <div className={`rounded-2xl border p-4 ${surface}`}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* ── Wider: a real table ─────────────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)]">
        <table className="w-full text-[14px] border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-[var(--line)]">
              {columns.map(col => (
                <th key={col.key} scope="col"
                  className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em]
                    text-[var(--ink-faint)] whitespace-nowrap
                    ${col.numeric ? 'text-right' : 'text-left'}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-[var(--line-soft)] last:border-0
                  ${needsAttention?.(row) ? 'bg-[var(--attention-soft)]' : ''}
                  ${onRowClick
                    ? `cursor-pointer transition-colors ${needsAttention?.(row) ? '' : 'hover:bg-[var(--canvas)]'}`
                    : ''}`}>
                {columns.map(col => (
                  <td key={col.key}
                    className={`px-4 py-3 text-[var(--ink)] align-middle
                      ${col.numeric ? 'text-right tabular-nums' : 'text-left'}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
