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
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
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
      className={`bg-[var(--paper)] border border-[var(--line)] rounded-xl
        ${hover ? 'transition-all duration-200 hover:border-[var(--ink-faint)] hover:shadow-[0_2px_16px_rgba(0,0,0,0.04)] cursor-pointer' : ''}
        ${className}`}>
      {children}
    </div>
  )
}

/* ─────────────────────────────────────────────
   StatCard — metric display
   ───────────────────────────────────────────── */
export function StatCard({
  label, value, sub, icon, accent = false,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon?: React.ReactNode
  accent?: boolean
}) {
  return (
    <div className={`relative rounded-xl border p-5 overflow-hidden
      ${accent ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'bg-[var(--paper)] border-[var(--line)]'}`}>
      <div className="flex items-start justify-between">
        <div className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${accent ? 'text-white/70' : 'text-[var(--ink-faint)]'}`}>
          {label}
        </div>
        {icon && (
          <div className={accent ? 'text-white/50' : 'text-[var(--ink-faint)]'}>{icon}</div>
        )}
      </div>
      <div className={`font-display text-[30px] leading-none font-semibold mt-3 ${accent ? 'text-white' : 'text-[var(--ink)]'}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-xs mt-1.5 ${accent ? 'text-white/60' : 'text-[var(--ink-faint)]'}`}>{sub}</div>
      )}
    </div>
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
    neutral: 'bg-[var(--line-soft)] text-[var(--ink-soft)]',
    accent:  'bg-[var(--accent-soft)] text-[var(--accent)]',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger:  'bg-red-50 text-red-600',
    muted:   'bg-[var(--line-soft)] text-[var(--ink-faint)]',
  }
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md ${tones[tone]}`}>
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
