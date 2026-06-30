'use client'
import { PageHeader, EmptyState, Card } from '@/components/ui'
import SharedLinks from '@/components/shared/SharedLinks'
import { useState, useEffect } from 'react'
import { Link2, MessageSquareQuote, Copy } from 'lucide-react'
import { CONFIG } from '@/lib/config'
import { toast } from 'sonner'

export default function MyLinksPage() {
  const [hasLinks, setHasLinks] = useState<boolean | null>(null)
  const testimonialLink = `${CONFIG.appUrl}/testimonial/submit`
  useEffect(() => {
    fetch('/api/links').then(r => r.ok ? r.json() : { links: [] })
      .then(d => setHasLinks((d.links || []).length > 0)).catch(() => setHasLinks(false))
  }, [])

  return (
    <div className="fade-in w-full">
      <PageHeader
        eyebrow="My work"
        title="My links"
        description="Links shared by the office — Zoom classes, info sessions, announcements. They appear here automatically and update on their own."
      />

      {/* Testimonial collection link — available to every staff member */}
      <Card className="p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
            
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[var(--ink)] text-sm">Testimonial collection link</div>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5 mb-2.5">Send this to students who've completed. They fill in their words and photo, and they're added to Alumni automatically.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-[var(--canvas)] rounded-lg px-3 py-2 text-[var(--ink-soft)] truncate">{testimonialLink}</code>
              <button onClick={() => { navigator.clipboard.writeText(testimonialLink); toast.success('Testimonial link copied') }}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[var(--accent)] text-white text-xs font-medium flex-shrink-0">
                 Copy
              </button>
            </div>
          </div>
        </div>
      </Card>

      <SharedLinks />
      {hasLinks === false && (
        <EmptyState  title="No links right now"
          description="When the office shares a link, it shows up here." />
      )}
    </div>
  )
}
