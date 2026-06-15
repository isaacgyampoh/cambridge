'use client'

import React from 'react'
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
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
      <div>
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)] mb-2">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[28px] leading-tight font-semibold text-[var(--ink)]">
          {title}
        </h1>
        {description && (
          <p className="text-[var(--ink-soft)] text-sm mt-1.5 max-w-xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">{actions}</div>}
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
  icon?: React.ReactNode
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}

export function Button({
  children, onClick, href, variant = 'primary', size = 'md', icon, disabled, type = 'button', className = '',
}: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap'
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm' }
  const variants = {
    primary:   'bg-[var(--accent)] text-white hover:brightness-110 active:brightness-95 shadow-sm',
    secondary: 'bg-white text-[var(--ink)] border border-[var(--line)] hover:border-[var(--ink-faint)] hover:bg-[var(--line-soft)]',
    ghost:     'text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]',
    danger:    'bg-white text-red-600 border border-red-200 hover:bg-red-50',
  }
  const cls = `${base} ${sizes[size]} ${variants[variant]} ${className}`
  if (href) return <Link href={href} className={cls}>{icon}{children}</Link>
  return <button type={type} onClick={onClick} disabled={disabled} className={cls}>{icon}{children}</button>
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
      className={`bg-[var(--paper)] border border-[var(--line)] rounded-2xl shadow-[0_1px_2px_rgba(31,29,26,0.04),0_1px_3px_rgba(31,29,26,0.02)]
        ${hover ? 'transition-all duration-200 hover:border-[var(--line)] hover:shadow-[0_4px_20px_rgba(31,29,26,0.06),0_2px_6px_rgba(31,29,26,0.03)] hover:-translate-y-px cursor-pointer' : ''}
        ${className}`}>
      {children}
    </div>
  )
}

/* ─────────────────────────────────────────────
   StatCard — metric display
   ───────────────────────────────────────────── */
export function StatCard({
  label, value, sub, icon, accent = false, trend, spark,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon?: React.ReactNode
  accent?: boolean
  trend?: { value: string; up?: boolean }
  spark?: number[]
}) {
  return (
    <div className={`relative rounded-2xl border p-5 overflow-hidden transition-all duration-200
      ${accent
        ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-[0_4px_20px_rgba(47,128,214,0.20)]'
        : 'bg-[var(--paper)] border-[var(--line)] shadow-[0_1px_2px_rgba(31,29,26,0.04)]'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${accent ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>
          {label}
        </div>
        {icon && (
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 -mr-1 -mt-1
            ${accent ? 'bg-white/15 text-white' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={`font-display text-[30px] leading-none font-semibold ${accent ? 'text-white' : 'text-[var(--ink)]'}`}>
            {value}
          </div>
          {(sub || trend) && (
            <div className="flex items-center gap-2 mt-2">
              {trend && (
                <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md
                  ${accent ? 'bg-white/15 text-white' : trend.up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                  {trend.up ? '↑' : '↓'} {trend.value}
                </span>
              )}
              {sub && <span className={`text-xs ${accent ? 'text-white/60' : 'text-[var(--ink-faint)]'}`}>{sub}</span>}
            </div>
          )}
        </div>
        {spark && spark.length > 1 && <Sparkline data={spark} accent={accent} />}
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
    <div className="border border-dashed border-[var(--line)] rounded-xl py-16 px-6 text-center bg-[var(--paper)]">
      {icon && (
        <div className="w-12 h-12 rounded-full bg-[var(--line-soft)] flex items-center justify-center mx-auto mb-4 text-[var(--ink-faint)]">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold text-[var(--ink)]">{title}</h3>
      {description && <p className="text-sm text-[var(--ink-soft)] mt-1.5 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
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
  const tones = {
    neutral: 'bg-[var(--line-soft)] text-[var(--ink-soft)] ring-[var(--line)]',
    accent:  'bg-[var(--accent-soft)] text-[var(--accent)] ring-[var(--accent)]/15',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-700 ring-amber-200',
    danger:  'bg-red-50 text-red-600 ring-red-200',
    muted:   'bg-[var(--line-soft)] text-[var(--ink-faint)] ring-[var(--line)]',
  }
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full ring-1 ring-inset ${tones[tone]}`}>
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
      <label className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">{label}</span>
        {required && <span className="text-[var(--accent)]">*</span>}
        {hint && <span className="text-[11px] text-[var(--ink-faint)] normal-case font-normal tracking-normal">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

export const inputClass =
  'w-full h-11 px-3.5 rounded-lg border border-[var(--line)] bg-white text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition'

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
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-faint)]">{children}</span>
      <div className="flex-1 h-px bg-[var(--line)]" />
    </div>
  )
}
