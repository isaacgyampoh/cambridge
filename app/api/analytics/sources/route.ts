import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

const ALLOWED = ['super_admin', 'project_manager', 'content_manager']

/**
 * Lead-source analytics: how many applications + registrations came from
 * each ad platform (Facebook/Google/LinkedIn etc.), based on UTM tags.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const sb = createServiceClient()
  const { data: apps } = await sb.from('applications')
    .select('landing_source, utm_source, utm_campaign, payment_status, created_at')
    .limit(5000)

  const rows = apps || []
  const bySource: Record<string, { label: string; applications: number; registrations: number }> = {}
  const byCampaign: Record<string, { campaign: string; source: string; applications: number; registrations: number }> = {}

  for (const a of rows) {
    const label = a.landing_source || (a.utm_source ? a.utm_source : 'Direct / Marketer link')
    if (!bySource[label]) bySource[label] = { label, applications: 0, registrations: 0 }
    bySource[label].applications++
    const registered = a.payment_status === 'paid' || a.payment_status === 'partial'
    if (registered) bySource[label].registrations++

    if (a.utm_campaign) {
      const key = `${a.utm_campaign}__${label}`
      if (!byCampaign[key]) byCampaign[key] = { campaign: a.utm_campaign, source: label, applications: 0, registrations: 0 }
      byCampaign[key].applications++
      if (registered) byCampaign[key].registrations++
    }
  }

  const sources = Object.values(bySource).sort((a, b) => b.applications - a.applications)
  const campaigns = Object.values(byCampaign).sort((a, b) => b.applications - a.applications)
  const total = rows.length

  return NextResponse.json({ sources, campaigns, total })
}
