'use client'

import React from 'react'
import { Inbox } from 'lucide-react'
import Link from 'next/link'

/* ─────────────────────────────────────────────
   PageHeader — consistent title block
   ───────────────────────────────────────────── */
export function PageHeader({
  eyebrow, title, description, actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    /*
     * The title column must win the space fight.
     *
     * It previously had no min-w-0 and no flex-1 while the actions container
     * was flex-shrink-0, so a screen with several buttons starved the heading
     * down to its narrowest possible column — the leads page rendered its
     * description one word per line. The title now takes the room and the
     * actions wrap beneath it when they cannot fit.
     */
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 lg:gap-6 mb-5 sm:mb-6">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="t-overline mb-1.5">{eyebrow}</div>}
        <h1 className="t-display">{title}</h1>
        {description && <p className="t-lead mt-1 max-w-prose">{description}</p>}
      </div>

      {actions && (
        /*
         * The actions WRAP. They do not scroll sideways.
         *
         * This row used to bleed to the screen edge with `-mx-5 px-5` so it
         * could scroll horizontally. The bleed is a fixed 20px while the page
         * padding around it is 16px on a phone, 28px from sm and 40px from lg
         * — it matched none of them, so the row was 8px wider than the page at
         * mobile widths and misaligned at every other. Only `overflow-x-hidden`
         * on the scroll container was hiding it.
         *
         * Wrapping is also the better behaviour: a horizontal scroller with no
         * visible scrollbar hides actions with nothing to say they are there.
         */
        <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap lg:justify-end
          lg:flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Button
   ───────────────────────────────────────────── */
type BtnProps = {
  children: React.ReactNode
  onClick?: () => void
  href?: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}

export function Button({
  children, onClick, href, variant = 'primary', size = 'md', disabled,
  type = 'button', className = '', block = false,
}: BtnProps & { block?: boolean }) {
  /*
   * A disabled button stops looking like the action it performs.
   *
   * `opacity-40` on a solid green left a washed-out green pill that still read
   * as "press me" — the strongest thing on a form, greyed slightly. Disabled
   * now drops to a flat neutral, so the eye passes over it.
   */
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-colors duration-150 whitespace-nowrap select-none disabled:pointer-events-none disabled:bg-[var(--line-soft)] disabled:text-[var(--ink-faint)] disabled:border-transparent disabled:shadow-none'
  const sizes = { sm: 'h-10 sm:h-9 px-4 sm:px-3.5 text-[13px] sm:text-[13px]', md: 'h-12 sm:h-11 px-5 text-[15px] sm:text-[14px]' }
  /*
   * One solid button per screen, and it is this one.
   *
   * Secondary and ghost stay quiet on purpose: if every action is filled, the
   * person has to read all of them to find the one that matters.
   */
  const variants = {
    primary:   'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]',
    secondary: 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--line)] hover:bg-[var(--canvas)]',
    ghost:     'text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]',
    danger:    'bg-[var(--paper)] text-[var(--danger)] border border-[var(--danger)]/25 hover:bg-[var(--danger-soft)]',
  }
  const cls = `${base} ${sizes[size]} ${variants[variant]} ${block ? 'w-full' : ''} ${className}`
  /*
   * An icon goes in the content, not in a prop.
   *
   *   <Button><Plus size={16} aria-hidden="true" /> Add lead</Button>
   *
   * There used to be an `icon` prop that this render ignored entirely, so a
   * caller who passed one got nothing and no warning. The gap in `base`
   * spaces an icon from its label already.
   */
  if (href) return <Link href={href} className={cls}>{children}</Link>
  return <button type={type} onClick={onClick} disabled={disabled} className={cls}>{children}</button>
}

/* ─────────────────────────────────────────────
   Card
   ───────────────────────────────────────────── */
export function Card({
  children, className = '', hover = false, onClick,
}: {
  children: React.ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-[var(--paper)] border border-[var(--line)] rounded-2xl
        ${hover ? 'transition-colors duration-150 hover:border-[var(--ink-faint)] cursor-pointer' : ''}
        ${className}`}>
      {children}
    </div>
  )
}

/* ─────────────────────────────────────────────
   StatCard — metric display
   ───────────────────────────────────────────── */
/**
 * A figure, its label, and optionally how it has been moving.
 *
 * ── TWO PROPS THAT DID NOTHING ─────────────────────────────────────────────
 *
 * `icon` was accepted, typed, and rendered inside `{false && icon && …}` — the
 * branch was hardcoded off when icons were stripped from the system, and the
 * prop was left in the signature. A caller passing one got silence.
 *
 * `spark` was worse: destructured and then never referenced anywhere in the
 * markup. The conversions dashboard passes twelve months of real figures to
 * it and has been drawing nothing. A Sparkline component existed the whole
 * time.
 *
 * `icon` is gone rather than restored — the design system puts an icon in the
 * content now, and no caller passes one. `spark` draws.
 */
export function StatCard({
  label, value, sub, accent = false, trend, spark,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  accent?: boolean
  trend?: { value: string; up?: boolean }
  /** A short series — the last twelve months, say. Drawn beside the figure. */
  spark?: number[]
}) {
  return (
    <div className={`relative rounded-2xl border p-5 overflow-hidden transition-all duration-200
      ${accent
        ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
        : 'bg-[var(--paper)] border-[var(--line)]'}`}>
      <div className="mb-3">
        <div className={`text-[14px] font-medium ${accent ? 'text-white/80' : 'text-[var(--ink-soft)]'}`}>
          {label}
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={`font-display text-[24px] leading-none font-semibold ${accent ? 'text-white' : 'text-[var(--ink)]'}`}>
            {value}
          </div>
          {(sub || trend) && (
            <div className="flex items-center gap-2 mt-2">
              {trend && (
                <span className={`inline-flex items-center text-[12px] font-semibold px-1.5 py-0.5 rounded-lg
                  ${accent ? 'bg-white/15 text-white' : trend.up ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'}`}>
                  {trend.up ? '+' : '-'}{trend.value}
                </span>
              )}
              {sub && <span className={`text-[13px] ${accent ? 'text-white/60' : 'text-[var(--ink-faint)]'}`}>{sub}</span>}
            </div>
          )}
        </div>

        {/* The shape of the figure over time, when the caller has it. */}
        {spark && spark.length > 1 && (
          <Sparkline data={spark} accent={accent} />
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Sparkline — tiny inline trend chart
   ───────────────────────────────────────────── */
export function Sparkline({ data, accent = false, width = 64, height = 32 }: { data: number[]; accent?: boolean; width?: number; height?: number }) {
  const max = Math.max(...data), min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((d - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')
  const stroke = accent ? 'rgba(255,255,255,0.85)' : 'var(--accent)'
  const fill = accent ? 'rgba(255,255,255,0.12)' : 'var(--accent-soft)'
  return (
    <svg width={width} height={height} className="flex-shrink-0" viewBox={`0 0 ${width} ${height}`}>
      <polyline points={`0,${height} ${pts} ${width},${height}`} fill={fill} stroke="none" opacity={0.6} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─────────────────────────────────────────────
   EmptyState
   ───────────────────────────────────────────── */
export function EmptyState({
  icon, title, description, action,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    /*
     * A centred mark, a short line, and the way forward.
     *
     * This was a dashed box with a large heading — the dashes read as a
     * dropzone and the heading gave "nothing here" the same weight as the page
     * title. A quiet circular mark carries the state without competing with
     * the content that will eventually replace it.
     */
    <div className="py-14 px-6 text-center">
      {/*
        A quiet outlined mark rather than a filled disc with a dot in it.
        The dot read as something half-loaded — a placeholder that never
        resolved — which is the one impression an empty state must not give.
      */}
      <span aria-hidden="true"
        className="w-12 h-12 rounded-2xl border border-[var(--line)] bg-[var(--paper)]
          grid place-items-center mx-auto mb-4 text-[var(--ink-faint)]">
        {icon || <Inbox size={20} strokeWidth={1.5} />}
      </span>
      <h3 className="text-[15px] font-semibold text-[var(--ink)]">{title}</h3>
      {description && (
        <p className="t-sub mt-1.5 max-w-[34ch] mx-auto leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-6 inline-flex">{action}</div>}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Badge
   ───────────────────────────────────────────── */
export function Badge({
  children, tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'
}) {
  /* Shared with StatusBadge — see the note on TONE_CLASSES in primitives. */
  const tones = {
    neutral: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
    accent:  'bg-[var(--brand-soft)] text-[var(--accent)]',
    success: 'bg-[var(--brand-soft)] text-[var(--accent)]',
    warning: 'bg-[var(--warn-soft)] text-[var(--warn)]',
    danger:  'bg-[var(--danger-soft)] text-[var(--danger)]',
    muted:   'bg-[var(--line-soft)] text-[var(--ink-faint)]',
  }
  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-2.5 py-[3px] rounded-full ${tones[tone]}`}>
      {children}
    </span>
  )
}

/* ─────────────────────────────────────────────
   Field — labeled input wrapper
   ───────────────────────────────────────────── */
export function Field({
  label, hint, children, required,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-baseline gap-1.5 mb-2">
        <span className="text-[13px] font-medium text-[var(--ink)]">{label}</span>
        {required && <span className="text-[var(--accent)]">*</span>}
        {hint && <span className="text-[12px] text-[var(--ink-faint)] font-normal">· {hint}</span>}
      </label>
      {children}
    </div>
  )
}

export const inputClass =
  'w-full h-12 sm:h-11 px-4 sm:px-3.5 rounded-lg border border-[var(--line)] bg-[var(--paper)] text-[15px] sm:text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition-shadow'

// For multi-line inputs — same look as inputClass but auto-height with comfortable padding.
export const textareaClass =
  'w-full px-4 sm:px-3.5 py-3 rounded-lg border border-[var(--line)] bg-[var(--paper)] text-[15px] sm:text-[14px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] transition-shadow resize-y'

/* ─────────────────────────────────────────────
   Spinner
   ───────────────────────────────────────────── */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex justify-center py-20 ${className}`}>
      <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full spin" />
    </div>
  )
}

/* ─────────────────────────────────────────────
   SectionLabel — eyebrow divider
   ───────────────────────────────────────────── */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <span className="t-overline">{children}</span>
    </div>
  )
}

/* ─────────────────────────────────────────────
   The rest of the design system
   ─────────────────────────────────────────────

   Re-exported here so a screen writes one import for the whole system:

       import { PageHeader, Card, Input, StatusBadge } from '@/components/ui'

   The alternative — four import lines from four files — is how screens drift
   into hand-rolling a control rather than hunting for the one that exists. */

export {
  StatusBadge, IconButton, Avatar, SectionHeader, LoadingState, Pagination,
  initialsOf, TONE_CLASSES, TONE_DOT, ProgressSteps,
} from './primitives'
export type { ProgressStep } from './primitives'

export {
  Input, SecretInput, Textarea, Select, Search, DateField, DateRange,
  FormSection, FormActions,
} from './forms'
export type { InputPurpose, Option } from './forms'

export { Dialog, BottomSheet, ActionMenu, Tabs, TabPanel } from './overlays'
export type { SheetAction, TabItem } from './overlays'

export { MobileList, ListRow, RowAction } from './MobileList'
export type { ListRowProps } from './MobileList'

export {
  Skeleton, SkeletonText, SkeletonStat, SkeletonCard, SkeletonList,
  ErrorState, ConfirmDialog,
} from './states'

export { PinBoxes } from './PinFields'

export { DataTable } from './DataTable'
export type { Column, DataTableProps } from './DataTable'
