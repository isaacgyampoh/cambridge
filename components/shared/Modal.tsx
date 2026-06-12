'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose?: () => void
  children: React.ReactNode
  /** Tailwind max-width class, e.g. "max-w-lg" */
  maxWidth?: string
  /** Click outside to close (default true) */
  closeOnBackdrop?: boolean
}

/**
 * Renders its children in a centered overlay attached to document.body
 * via a portal. This guarantees the modal escapes any ancestor with
 * `overflow: hidden/auto` (like the scrollable <main> in PortalLayout),
 * which would otherwise clip a position:fixed element.
 */
export default function Modal({
  open,
  onClose,
  children,
  maxWidth = 'max-w-lg',
  closeOnBackdrop = true,
}: ModalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open || !onClose) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] overflow-y-auto p-4 flex items-start sm:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={closeOnBackdrop && onClose ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
    >
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} my-auto`}>
        {children}
      </div>
    </div>,
    document.body
  )
}
