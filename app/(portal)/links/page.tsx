'use client'
import { PageHeader, EmptyState } from '@/components/ui'
import SharedLinks from '@/components/shared/SharedLinks'
import { useState, useEffect } from 'react'
import { Link2 } from 'lucide-react'

export default function MyLinksPage() {
  const [hasLinks, setHasLinks] = useState<boolean | null>(null)
  useEffect(() => {
    fetch('/api/links').then(r => r.ok ? r.json() : { links: [] })
      .then(d => setHasLinks((d.links || []).length > 0)).catch(() => setHasLinks(false))
  }, [])

  return (
    <div className="fade-in w-full max-w-2xl">
      <PageHeader
        eyebrow="My work"
        title="My links"
        description="Links shared by the office — Zoom classes, info sessions, announcements. They appear here automatically and update on their own."
      />
      <SharedLinks />
      {hasLinks === false && (
        <EmptyState icon={<Link2 size={20} />} title="No links right now"
          description="When the office shares a link, it shows up here." />
      )}
    </div>
  )
}
