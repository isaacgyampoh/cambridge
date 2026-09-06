'use client'

import React, { useState, useCallback, useRef } from 'react'
import { ConfirmDialog } from '@/components/ui/states'

/**
 * A confirmation you can await, as a drop-in for `window.confirm`.
 *
 * Roughly fifteen destructive actions across the portal guard themselves with
 * the native dialog:
 *
 *     if (!confirm('Delete this flyer? Its link will stop working.')) return
 *
 * That is not missing confirmation, but it has three real problems. It cannot
 * be styled, so on a phone it reads like a scam popup rather than part of the
 * application. It blocks the main thread. And browsers let someone tick
 * "prevent this page from creating additional dialogs" — after which every
 * later confirm returns false silently, and the delete button simply stops
 * working with no explanation.
 *
 * This keeps the shape that made `confirm` pleasant to use — one line, at the
 * top of the handler, reading like a guard — while rendering a real dialog:
 *
 *     const { confirm, dialog } = useConfirm()
 *
 *     async function remove(flyer) {
 *       if (!await confirm({
 *         title: 'Delete this flyer?',
 *         message: 'Its link will stop working immediately.',
 *         confirmLabel: 'Delete flyer',
 *       })) return
 *       …
 *     }
 *
 *     return <>{dialog}{…}</>
 */

export type ConfirmOptions = {
  title: string
  /** Rich content allowed — bulk actions need to show their counts. */
  message: React.ReactNode
  /** The verb, not "OK" — someone skimming should see what will happen. */
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'accent'
  /**
   * Demand this exact phrase be typed before the action can be taken.
   *
   * Reserved for what cannot be undone or reconstructed. See ConfirmDialog.
   */
  requirePhrase?: string
  /** One dismiss button and nothing to decide. See `notify` below. */
  notice?: boolean
  /** Collect a value as part of the confirmation. See `ask` below. */
  input?: {
    label: string
    placeholder?: string
    required?: boolean
    inputMode?: 'text' | 'tel' | 'numeric' | 'email'
  }
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

/** What `ask` hands back: the typed value, or null if it was cancelled. */
export type AskResult = string | null

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)

  // Held in a ref as well so a second call cannot strand the first promise
  // unresolved — an unresolved confirm would hang the handler awaiting it.
  const current = useRef<Pending | null>(null)

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    // A confirmation already open is answered "no" before the new one opens,
    // so its caller unwinds cleanly rather than waiting forever.
    current.current?.resolve(false)

    return new Promise<boolean>(resolve => {
      const next: Pending = { ...opts, resolve }
      current.current = next
      setPending(next)
    })
  }, [])

  /**
   * Show a message that needs no decision — a diagnostic result, a report.
   *
   * The alternative in use was alert(), which blocks the main thread, cannot
   * be styled, and can be suppressed by the browser after the first one, at
   * which point the diagnostic buttons silently stopped reporting anything.
   * A toast is the right home for one line; this is for the ones that print
   * a list.
   */
  const notify = useCallback((opts: Omit<ConfirmOptions, 'tone'> & { tone?: 'danger' | 'accent' }) => {
    current.current?.resolve(false)
    return new Promise<boolean>(resolve => {
      const next: Pending = {
        tone: 'accent', confirmLabel: 'Close', ...opts, notice: true, resolve,
      }
      current.current = next
      setPending(next)
    })
  }, [])

  /*
   * The value the person typed, kept outside React state.
   *
   * ConfirmDialog owns the field and hands the value up on confirm; this
   * carries it to whoever is awaiting `ask`, without a re-render per
   * keystroke in this hook.
   */
  const answer = useRef('')

  const settle = useCallback((ok: boolean) => {
    current.current?.resolve(ok)
    current.current = null
    setPending(null)
    setBusy(false)
  }, [])

  /**
   * Ask for one value — a reference, a name, a phone number.
   *
   * Resolves to the string, or null if it was cancelled. This is the
   * replacement for window.prompt(), which four screens used and which some
   * mobile webviews refuse to display at all.
   */
  const ask = useCallback((
    opts: Omit<ConfirmOptions, 'message'> & { message?: React.ReactNode; input: NonNullable<ConfirmOptions['input']> }
  ): Promise<AskResult> => {
    current.current?.resolve(false)
    answer.current = ''

    return new Promise<AskResult>(resolve => {
      const next: Pending = {
        tone: 'accent',
        message: opts.message ?? null,
        ...opts,
        resolve: (ok: boolean) => resolve(ok ? answer.current : null),
      }
      current.current = next
      setPending(next)
    })
  }, [])

  const dialog = pending ? (
    <ConfirmDialog
      open
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      tone={pending.tone}
      requirePhrase={pending.requirePhrase}
      notice={pending.notice}
      busy={busy}
      input={pending.input}
      onConfirm={value => { answer.current = value; setBusy(true); settle(true) }}
      onCancel={() => settle(false)}
    />
  ) : null

  return { confirm, notify, ask, dialog }
}
