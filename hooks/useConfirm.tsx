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
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

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

  const settle = useCallback((answer: boolean) => {
    current.current?.resolve(answer)
    current.current = null
    setPending(null)
    setBusy(false)
  }, [])

  const dialog = pending ? (
    <ConfirmDialog
      open
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      tone={pending.tone}
      busy={busy}
      onConfirm={() => { setBusy(true); settle(true) }}
      onCancel={() => settle(false)}
    />
  ) : null

  return { confirm, dialog }
}
