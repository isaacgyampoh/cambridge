'use client'

import React, { useId, useState } from 'react'
import { Search as SearchIcon, X, ChevronDown, Eye, EyeOff } from 'lucide-react'

/**
 * Form controls.
 *
 * ── WHY THESE ARE COMPONENTS, NOT A CLASS STRING ───────────────────────────
 *
 * The system previously exported `inputClass` and each screen assembled its
 * own <label> and <input> around it. That got the border right and everything
 * else wrong: labels were divs, so tapping one did not focus the field;
 * validation messages were unassociated text, so a screen reader announced an
 * empty box with no reason; and `type` was almost always "text", which on a
 * phone means a full QWERTY keyboard for a phone number.
 *
 * These wire the label, the hint and the error to the control with real ids,
 * and pick the keyboard from the field's purpose. `inputClass` is still
 * exported from ./index for the places that legitimately need a bare control.
 */

/* ─────────────────────────────────────────────
   Shared field chrome
   ───────────────────────────────────────────── */

const base =
  'w-full rounded-xl border bg-white text-[var(--ink)] placeholder:text-[var(--ink-faint)] ' +
  'transition-shadow focus:outline-none focus:ring-4 disabled:opacity-60 disabled:bg-[var(--canvas)]'

/** 16px on phones is not a style choice: iOS zooms the page in below it. */
const sizing = 'h-12 sm:h-11 px-4 sm:px-3.5 text-[16px] sm:text-[14px]'

const ok = 'border-[var(--line)] focus:border-[var(--accent)] focus:ring-[var(--accent-soft)]'
const bad = 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger-soft)]'

function controlClass(invalid?: boolean, extra = '') {
  return `${base} ${sizing} ${invalid ? bad : ok} ${extra}`
}

type FieldChrome = {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  /** Hide the visible label but keep it for assistive technology. */
  hideLabel?: boolean
  className?: string
}

/**
 * The label, hint and error around a control.
 *
 * Returns the ids the control must carry, so the association is made by
 * construction rather than by each caller remembering to add aria-describedby.
 */
function useFieldIds(props: FieldChrome) {
  const id = useId()
  const hintId = props.hint ? `${id}-hint` : undefined
  const errorId = props.error ? `${id}-error` : undefined
  return {
    id,
    describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined,
    hintId,
    errorId,
  }
}

function FieldShell({
  chrome, id, hintId, errorId, children,
}: {
  chrome: FieldChrome
  id: string
  hintId?: string
  errorId?: string
  children: React.ReactNode
}) {
  return (
    <div className={chrome.className}>
      <label htmlFor={id}
        className={chrome.hideLabel
          ? 'sr-only'
          : 'flex items-baseline gap-1.5 mb-1.5 text-[13px] font-medium text-[var(--ink)]'}>
        {chrome.label}
        {chrome.required && <span className="text-[var(--accent)]" aria-hidden="true">*</span>}
      </label>

      {chrome.hint && !chrome.error && (
        <p id={hintId} className="text-[12.5px] text-[var(--ink-faint)] mb-1.5 leading-snug">
          {chrome.hint}
        </p>
      )}

      {children}

      {chrome.error && (
        // role="alert" so the reason is announced when it appears, rather than
        // being silent text next to a field the user has already left.
        <p id={errorId} role="alert"
          className="text-[12.5px] text-[var(--danger)] mt-1.5 leading-snug">
          {chrome.error}
        </p>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Input
   ───────────────────────────────────────────── */

/**
 * `purpose` picks the keyboard, the autocomplete token and the input mode
 * together. Asking for "phone" once is more reliable than expecting every
 * caller to remember inputMode="tel" AND autoComplete="tel" AND type="tel".
 */
export type InputPurpose =
  | 'text' | 'name' | 'email' | 'phone' | 'number' | 'money'
  | 'search' | 'url' | 'date' | 'time' | 'pin'

const PURPOSE: Record<InputPurpose, {
  type: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  autoComplete?: string
  pattern?: string
}> = {
  text:   { type: 'text' },
  name:   { type: 'text', autoComplete: 'name' },
  email:  { type: 'email', inputMode: 'email', autoComplete: 'email' },
  phone:  { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  number: { type: 'text', inputMode: 'numeric', pattern: '[0-9]*' },
  money:  { type: 'text', inputMode: 'decimal' },
  search: { type: 'search', inputMode: 'search' },
  url:    { type: 'url', inputMode: 'url' },
  date:   { type: 'date' },
  time:   { type: 'time' },
  // One-time codes: the numeric keypad, and the OS offers the SMS code.
  pin:    { type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code', pattern: '[0-9]*' },
}

export function Input({
  purpose = 'text', value, onChange, placeholder, disabled, maxLength,
  min, max, step, autoFocus, onKeyDown, ...chrome
}: FieldChrome & {
  purpose?: InputPurpose
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  min?: number | string
  max?: number | string
  step?: number | string
  autoFocus?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const { id, describedBy, hintId, errorId } = useFieldIds(chrome)
  const cfg = PURPOSE[purpose]

  return (
    <FieldShell chrome={chrome} id={id} hintId={hintId} errorId={errorId}>
      <input
        id={id}
        type={cfg.type}
        inputMode={cfg.inputMode}
        autoComplete={cfg.autoComplete}
        pattern={cfg.pattern}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        min={min} max={max} step={step}
        autoFocus={autoFocus}
        required={chrome.required}
        aria-invalid={chrome.error ? true : undefined}
        aria-describedby={describedBy}
        className={controlClass(Boolean(chrome.error))}
      />
    </FieldShell>
  )
}

/* ─────────────────────────────────────────────
   PasswordInput — for the PIN change screen
   ───────────────────────────────────────────── */

export function SecretInput({
  value, onChange, placeholder, disabled, maxLength, ...chrome
}: FieldChrome & {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
}) {
  const { id, describedBy, hintId, errorId } = useFieldIds(chrome)
  const [shown, setShown] = useState(false)

  return (
    <FieldShell chrome={chrome} id={id} hintId={hintId} errorId={errorId}>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          required={chrome.required}
          aria-invalid={chrome.error ? true : undefined}
          aria-describedby={describedBy}
          className={controlClass(Boolean(chrome.error), 'pr-12 tracking-[0.3em]')}
        />
        <button
          type="button"
          onClick={() => setShown(s => !s)}
          aria-label={shown ? 'Hide' : 'Show'}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 inline-flex items-center
            justify-center text-[var(--ink-faint)] hover:text-[var(--ink-soft)] rounded-lg
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {shown ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
    </FieldShell>
  )
}

/* ─────────────────────────────────────────────
   Textarea
   ───────────────────────────────────────────── */

export function Textarea({
  value, onChange, placeholder, rows = 4, disabled, maxLength, ...chrome
}: FieldChrome & {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  maxLength?: number
}) {
  const { id, describedBy, hintId, errorId } = useFieldIds(chrome)

  return (
    <FieldShell chrome={chrome} id={id} hintId={hintId} errorId={errorId}>
      <textarea
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        maxLength={maxLength}
        required={chrome.required}
        aria-invalid={chrome.error ? true : undefined}
        aria-describedby={describedBy}
        className={`${base} ${chrome.error ? bad : ok} px-4 sm:px-3.5 py-3 text-[16px] sm:text-[14px] leading-relaxed resize-y`}
      />
      {maxLength && (
        <p className="text-[11.5px] text-[var(--ink-faint)] mt-1 text-right tabular-nums">
          {value.length}/{maxLength}
        </p>
      )}
    </FieldShell>
  )
}

/* ─────────────────────────────────────────────
   Select
   ───────────────────────────────────────────── */

export type Option = { value: string; label: string; disabled?: boolean }

export function Select({
  value, onChange, options, placeholder, disabled, ...chrome
}: FieldChrome & {
  value: string
  onChange: (value: string) => void
  options: Option[]
  /** Rendered as an empty first option, so the control can start unset. */
  placeholder?: string
  disabled?: boolean
}) {
  const { id, describedBy, hintId, errorId } = useFieldIds(chrome)

  return (
    <FieldShell chrome={chrome} id={id} hintId={hintId} errorId={errorId}>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          required={chrome.required}
          aria-invalid={chrome.error ? true : undefined}
          aria-describedby={describedBy}
          className={controlClass(Boolean(chrome.error), 'appearance-none pr-10 cursor-pointer')}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true"
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] pointer-events-none" />
      </div>
    </FieldShell>
  )
}

/* ─────────────────────────────────────────────
   Search
   ───────────────────────────────────────────── */

/**
 * A search box with a clear button.
 *
 * The clear button matters more on a phone than anywhere else: without it,
 * emptying a filter means selecting text in a small field and deleting it,
 * which is fiddly enough that people just reload the page instead.
 */
export function Search({
  value, onChange, placeholder = 'Search…', onSubmit, label = 'Search', autoFocus, className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onSubmit?: () => void
  /** Accessible name; hidden visually because the icon and placeholder carry it. */
  label?: string
  autoFocus?: boolean
  className?: string
}) {
  const id = useId()

  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <SearchIcon size={17} aria-hidden="true"
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)] pointer-events-none" />
      <input
        id={id}
        type="search"
        inputMode="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && onSubmit) onSubmit() }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`${base} ${ok} h-12 sm:h-11 pl-10 ${value ? 'pr-12' : 'pr-4'} text-[16px] sm:text-[14px]
          [&::-webkit-search-cancel-button]:hidden`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 inline-flex items-center
            justify-center text-[var(--ink-faint)] hover:text-[var(--ink)] rounded-lg
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Date
   ───────────────────────────────────────────── */

/**
 * A date field, using the platform picker.
 *
 * Deliberately not a custom calendar widget. The native control is already
 * localised, keyboard accessible and familiar, and on a phone it opens the
 * OS date wheel — which is better than anything worth hand-building here, and
 * costs no bundle.
 */
export function DateField({
  value, onChange, min, max, disabled, ...chrome
}: FieldChrome & {
  /** ISO yyyy-mm-dd. */
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
}) {
  return (
    <Input
      {...chrome}
      purpose="date"
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      disabled={disabled}
    />
  )
}

/** A from/to pair that cannot express an impossible range. */
export function DateRange({
  from, to, onFrom, onTo, label = 'Date range', className = '',
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  label?: string
  className?: string
}) {
  return (
    <fieldset className={className}>
      <legend className="text-[13px] font-medium text-[var(--ink)] mb-1.5">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {/* max/min are bound to each other, so "to" can never precede "from". */}
        <DateField label="From" hideLabel value={from} onChange={onFrom} max={to || undefined} />
        <DateField label="To" hideLabel value={to} onChange={onTo} min={from || undefined} />
      </div>
    </fieldset>
  )
}

/* ─────────────────────────────────────────────
   Form structure
   ───────────────────────────────────────────── */

/**
 * A titled group of fields.
 *
 * Long forms were single columns of twenty inputs. Sections give a phone user
 * somewhere to pause and a sense of how much is left, and give the page a real
 * heading structure instead of a wall.
 */
export function FormSection({
  title, description, children, className = '',
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`mb-7 ${className}`}>
      <h2 className="font-display text-[15px] font-semibold text-[var(--ink)] mb-1">{title}</h2>
      {description && (
        <p className="text-[13px] text-[var(--ink-soft)] mb-4 leading-relaxed">{description}</p>
      )}
      <div className={description ? 'space-y-4' : 'mt-4 space-y-4'}>{children}</div>
    </section>
  )
}

/**
 * The submit row.
 *
 * Sticks to the bottom of the viewport on a phone so the primary action is
 * reachable without scrolling to the end of a long form, and sits inline from
 * `sm` up where the whole form is usually visible anyway.
 */
export function FormActions({
  children, error, className = '',
}: {
  children: React.ReactNode
  /** A submission failure, shown next to the button that caused it. */
  error?: string | null
  className?: string
}) {
  return (
    <div className={`sticky bottom-0 sm:static -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0
      bg-[var(--canvas)]/95 sm:bg-transparent backdrop-blur-sm sm:backdrop-blur-none
      border-t border-[var(--line)] sm:border-0 safe-b sm:pb-0 ${className}`}>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger)] mb-2.5 leading-snug">{error}</p>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{children}</div>
    </div>
  )
}
