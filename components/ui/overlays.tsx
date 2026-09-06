'use client'

import React, { useEffect, useId, useRef, useState, useCallback } from 'react'
import { X, MoreVertical } from 'lucide-react'

/**
 * Things that appear over the page: dialogs, sheets, menus, and the tab
 * control that switches between panels within one.
 *
 * All of them are built on the native <dialog> element or on real ARIA
 * patterns rather than on divs with z-index. The browser then supplies the
 * focus trap, the Escape key, the inertness of the page behind and the
 * restoration of focus on close — the four things hand-built modals reliably
 * get wrong, and which matter most to whoever is using a keyboard or a screen
 * reader.
 */

/* ─────────────────────────────────────────────
   Dialog
   ───────────────────────────────────────────── */

/**
 * A modal for content, as distinct from ConfirmDialog which asks a question.
 *
 * On phones it is bottom-anchored and full width: a centred box on a 375px
 * screen wastes the edges and puts its actions under the thumb's reach. From
 * `sm` up it centres, which is what a pointer expects.
 */
export function Dialog({
  open, onClose, title, description, children, footer, size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  if (!open) return null

  const widths = { sm: 'sm:w-[400px]', md: 'sm:w-[520px]', lg: 'sm:w-[720px]' }

  return (
    <dialog
      ref={ref}
      onCancel={e => { e.preventDefault(); onClose() }}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={`backdrop:bg-black/40 backdrop:backdrop-blur-[2px] bg-transparent p-0
        m-0 sm:m-auto w-full max-w-full ${widths[size]}
        fixed bottom-0 sm:static max-h-[92dvh]`}
    >
      <div className="flex flex-col max-h-[92dvh] rounded-t-2xl sm:rounded-2xl
        bg-[var(--paper)] border border-[var(--line)] shadow-[var(--shadow-overlay)] text-left overflow-hidden">

        {/* A drag handle on phones: it reads as a sheet that can be dismissed,
            which is the convention people already know from native apps. */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center" aria-hidden="true">
          <span className="w-9 h-1 rounded-full bg-[var(--line)]" />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pt-3 sm:pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[17px] font-semibold text-[var(--ink)]">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-[13px] text-[var(--ink-soft)] mt-1 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-10 h-10 -mr-2 -mt-1 inline-flex items-center justify-center rounded-xl
              text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]
              transition-colors flex-shrink-0
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* The body scrolls, not the dialog, so the header and footer stay put
            on a small screen with a long form inside. */}
        <div className="px-5 pb-5 overflow-y-auto flex-1">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-[var(--line)] bg-[var(--canvas)] safe-b
            flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  )
}

/* ─────────────────────────────────────────────
   BottomSheet
   ───────────────────────────────────────────── */

/**
 * A list of actions, anchored to the bottom of a phone screen.
 *
 * This is what a row's overflow menu becomes on a phone. A dropdown pinned to
 * a 24px icon near the screen edge is a target most thumbs miss and a panel
 * that frequently opens off-screen; a sheet is reachable and cannot overflow.
 */
export type SheetAction = {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** A second line, for when the label alone is ambiguous. */
  hint?: string
}

export function BottomSheet({
  open, onClose, title, actions,
}: {
  open: boolean
  onClose: () => void
  title?: string
  actions: SheetAction[]
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={ref}
      onCancel={e => { e.preventDefault(); onClose() }}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : 'Actions'}
      className="backdrop:bg-black/40 bg-transparent p-0 m-0 fixed bottom-0 w-full max-w-full
        sm:m-auto sm:w-[380px] sm:static"
    >
      <div className="rounded-t-2xl sm:rounded-2xl bg-[var(--paper)] border border-[var(--line)]
        shadow-[var(--shadow-overlay)] overflow-hidden safe-b">
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center" aria-hidden="true">
          <span className="w-9 h-1 rounded-full bg-[var(--line)]" />
        </div>

        {title && (
          <h2 id={titleId}
            className="px-5 pt-3 pb-2 text-[13px] font-semibold text-[var(--ink-faint)] truncate">
            {title}
          </h2>
        )}

        <div className="py-1">
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={() => { action.onClick(); onClose() }}
              className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors
                min-h-[52px] disabled:opacity-40 disabled:pointer-events-none
                focus-visible:outline-none focus-visible:bg-[var(--line-soft)]
                ${action.tone === 'danger'
                  ? 'text-[var(--danger)] hover:bg-[var(--danger-soft)]'
                  : 'text-[var(--ink)] hover:bg-[var(--line-soft)]'}`}
            >
              {action.icon && <span className="flex-shrink-0" aria-hidden="true">{action.icon}</span>}
              <span className="min-w-0">
                <span className="block text-[14px] font-medium truncate">{action.label}</span>
                {action.hint && (
                  <span className="block text-[12px] text-[var(--ink-faint)] truncate">{action.hint}</span>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="border-t border-[var(--line)] p-3">
          <button type="button" onClick={onClose}
            className="w-full min-h-[46px] rounded-xl bg-[var(--canvas)] text-[14px]
              font-semibold text-[var(--ink-soft)] hover:bg-[var(--line-soft)] transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  )
}

/* ─────────────────────────────────────────────
   ActionMenu — dropdown on a pointer, sheet on a phone
   ───────────────────────────────────────────── */

/**
 * Secondary actions behind one control.
 *
 * The same actions render as a dropdown where there is a pointer and as a
 * BottomSheet on a phone. One call site, the right shape for the device —
 * which is what stops a row growing six buttons that nobody can hit.
 */
export function ActionMenu({
  actions, label = 'More actions', title, align = 'right',
}: {
  actions: SheetAction[]
  label?: string
  /** Heading for the sheet on phones. */
  title?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [isPhone, setIsPhone] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Measured, not guessed from the user agent. matchMedia keeps it correct
  // when a window is resized or a tablet is rotated.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const sync = () => setIsPhone(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open || isPhone) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, isPhone, close])

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      className="w-10 h-10 inline-flex items-center justify-center rounded-xl flex-shrink-0
        text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)] transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <MoreVertical size={18} aria-hidden="true" />
    </button>
  )

  if (isPhone) {
    return (
      <>
        {trigger}
        <BottomSheet open={open} onClose={close} title={title} actions={actions} />
      </>
    )
  }

  return (
    <div ref={wrap} className="relative">
      {trigger}
      {open && (
        <div role="menu" aria-label={label}
          className={`absolute z-30 mt-1 min-w-[200px] rounded-xl bg-[var(--paper)]
            border border-[var(--line)] shadow-[var(--shadow-overlay)] py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {actions.map(action => (
            <button
              key={action.label}
              role="menuitem"
              type="button"
              disabled={action.disabled}
              onClick={() => { action.onClick(); close() }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px]
                transition-colors disabled:opacity-40 disabled:pointer-events-none
                focus-visible:outline-none focus-visible:bg-[var(--line-soft)]
                ${action.tone === 'danger'
                  ? 'text-[var(--danger)] hover:bg-[var(--danger-soft)]'
                  : 'text-[var(--ink)] hover:bg-[var(--line-soft)]'}`}
            >
              {action.icon && <span className="flex-shrink-0" aria-hidden="true">{action.icon}</span>}
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Tabs
   ───────────────────────────────────────────── */

export type TabItem = { key: string; label: string; count?: number }

/**
 * A tab strip that scrolls horizontally rather than wrapping or truncating.
 *
 * Implements the ARIA tab pattern including arrow-key movement, because a
 * row of buttons that merely looks like tabs is not navigable by keyboard in
 * the way the appearance promises.
 */
export function Tabs({
  tabs, active, onChange, label = 'Sections', className = '',
}: {
  tabs: TabItem[]
  active: string
  onChange: (key: string) => void
  label?: string
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(t => t.key === active)
    if (i < 0) return
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[next].key)
    refs.current[tabs[next].key]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1
        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {tabs.map(tab => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            ref={el => { refs.current[tab.key] = el }}
            role="tab"
            type="button"
            aria-selected={selected}
            // Only the active tab is in the tab order; arrow keys move between
            // them. That is the ARIA pattern, and it stops a ten-tab strip
            // costing ten presses to skip past.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={`flex-shrink-0 min-h-[42px] px-3.5 rounded-xl text-[13px] font-semibold
              transition-colors whitespace-nowrap
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]
              ${selected
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--ink-soft)] hover:bg-[var(--line-soft)]'}`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`ml-1.5 tabular-nums text-[12px] ${selected ? 'text-white/75' : 'text-[var(--ink-faint)]'}`}>
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The panel a tab controls. Rendering nothing when inactive keeps it cheap. */
export function TabPanel({
  active, tabKey, children,
}: {
  active: string
  tabKey: string
  children: React.ReactNode
}) {
  if (active !== tabKey) return null
  return <div role="tabpanel" className="fade-in">{children}</div>
}
