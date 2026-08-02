'use client'
import { use } from 'react'
import LeadDetail from '@/app/(portal)/marketer/leads/[id]/page'

/**
 * Admin lead detail. Reuses the marketer view so there is one lead screen to
 * maintain — the underlying API already decides what this person may see.
 */
export default function AdminLeadDetail({ params }: { params: Promise<{ id: string }> }) {
  return <LeadDetail params={params} />
}
