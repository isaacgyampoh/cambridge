'use client'

import React from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

/**
 * Loading, error and confirmation states.
 *
 * Every screen has three outcomes besides success — still loading, nothing to
 * show, and something went wrong — and the app handled them inconsistently:
 * some pages showed a spinner, some showed nothing at all, and a failed fetch
 * usually left a blank panel with no way to retry.
 *
 * `EmptyState` already lives in components/ui/index.tsx. These are the other
 * two, plus the confirmation dialog that destructive actions need.
 *
 * All of it is built on the shared tokens in app/globals.css, so the portal and
 * the student app stay one visual system.
 */

/* ─────────────────────────────────────────────
   Skeletons — the shape of the content, not a spinner
   ───────────────────────────────────────────── */

/**
 * A single shimmering block. Prefer the composed skeletons below: a skeleton
 * is only worth more than a spinner when it has the shape of what is coming,
 * so the layout does not jump when the data lands.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-[var(--line-soft)] ${className}`}
    />
  )
}

/** Lines of text. The last line is short, the way real paragraphs end. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  )
}

/** A stat tile, matching StatCard's dimensions so nothing shifts on load. */
export function SkeletonStat() {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
      <Skeleton className="h-9 w-9 rounded-xl mb-3" />
      <Skeleton className="h-7 w-20 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-5">
      <Skeleton className="h-4 w-1/3 mb-4" />
      <SkeletonText lines={lines} />
    </div>
  )
}

/**
 * A list placeholder.
 *
 * Deliberately renders as rows of blocks rather than a <table> skeleton: on a
 * phone the real content is cards, not a table, so a table-shaped skeleton
 * would promise a layout that never arrives.
 */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] divide-y divide-[var(--line-soft)]"
      role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Error state
   ───────────────────────────────────────────── */

/**
 * Something failed and the person can do something about it.
 *
 * Takes a plain-language message, never a raw error. Server errors are logged
 * server-side; what reaches the screen says what happened and offers the retry.
 */
export function ErrorState({
  title = 'That did not load',
  message = 'Something went wrong on our side. Please try again.',
  onRetry,
  retryLabel = 'Try again',
}: {
  title?: string
  message?: string
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div role="alert"
      className="rounded-2xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] p-6 sm:p-8 text-center">
      <div className="w-11 h-11 rounded-full bg-[var(--danger)]/10 grid place-items-center mx-auto mb-4">
        <AlertCircle size={20} className="text-[var(--danger)]" aria-hidden="true" />
      </div>
      <div className="font-semibold text-[15px] text-[var(--ink)] mb-1.5">{title}</div>
      <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed max-w-sm mx-auto">{message}</p>
      {onRetry && (
        <button onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl
            bg-[var(--paper)] border border-[var(--line)] text-[14px] font-semibold text-[var(--ink)]
            hover:bg-[var(--line-soft)] transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2">
          <RefreshCw size={15} aria-hidden="true" />{retryLabel}
        </button>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Confirmation
   ───────────────────────────────────────────── */

/**
 * Confirm before something irreversible.
 *
 * Uses the native <dialog> element, so the browser provides the focus trap,
 * Escape handling and inertness of the page behind — all of which a hand-built
 * modal usually gets wrong.
 *
 * The confirm button carries the verb ("Delete"), never "OK": someone skimming
 * should be able to tell what is about to happen from the button alone.
 */
export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'danger', busy = false, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  /**
   * Rich content, not just a string: a bulk delete needs to show what will go
   * and what is protected, and those counts are the whole basis for the
   * decision. `window.confirm` could only fake this with \n, which renders as
   * nothing in HTML.
   */
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'accent'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  if (!open) return null

  const confirmTone = tone === 'danger'
    ? 'bg-[var(--danger)] text-white'
    : 'bg-[var(--accent)] text-white'

  return (
    <dialog ref={ref} onCancel={e => { e.preventDefault(); if (!busy) onCancel() }}
      aria-labelledby="confirm-title"
      className="backdrop:bg-black/40 bg-transparent p-0 m-auto max-w-[calc(100vw-32px)] w-[400px]">
      <div className="rounded-2xl bg-[var(--paper)] border border-[var(--line)] p-5 sm:p-6 shadow-[var(--shadow-overlay)] text-left">
        <h2 id="confirm-title" className="font-semibold text-[17px] text-[var(--ink)] mb-2">{title}</h2>
        <div className="text-[14px] text-[var(--ink-soft)] leading-relaxed mb-6">{message}</div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <button onClick={onCancel} disabled={busy}
            className="min-h-[44px] px-5 rounded-xl border border-[var(--line)] bg-[var(--paper)]
              text-[14px] font-semibold text-[var(--ink)] hover:bg-[var(--line-soft)]
              disabled:opacity-50 transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={busy} autoFocus
            className={`min-h-[44px] px-5 rounded-xl text-[14px] font-semibold
              disabled:opacity-60 transition-all hover:brightness-110
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
              focus-visible:ring-[var(--${tone === 'danger' ? 'danger' : 'accent'})] ${confirmTone}`}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
