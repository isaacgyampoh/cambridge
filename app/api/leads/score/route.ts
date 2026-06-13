import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Lead scoring engine. Scores every lead 0–100 by behavioural and
 * profile signals, then labels them hot / warm / cold so marketers
 * know who to prioritise. Rule-based: instant, free, explainable.
 */
function scoreLead(lead: any, activities: any[], signins: any[]): { score: number; label: string; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Status progression
  const statusPoints: Record<string, number> = {
    new: 5, contacted: 15, interested: 35, follow_up: 30,
    ready_to_join: 60, registered: 80, not_interested: -20, lost: -30,
  }
  const sp = statusPoints[lead.status] ?? 0
  score += sp
  if (sp >= 35) reasons.push(`Strong stage (${lead.status.replace(/_/g, ' ')})`)

  // Engagement: activities count
  const acts = activities.filter(a => a.lead_id === lead.id)
  if (acts.length >= 3) { score += 20; reasons.push(`${acts.length} interactions logged`) }
  else if (acts.length >= 1) { score += 10; reasons.push('Has been contacted') }

  // Recency of last activity
  const lastAct = acts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
  if (lastAct) {
    const days = (Date.now() - new Date(lastAct.created_at).getTime()) / 86400000
    if (days <= 2) { score += 15; reasons.push('Active in last 2 days') }
    else if (days > 14) { score -= 10; reasons.push('Gone quiet (14+ days)') }
  }

  // Replied on WhatsApp (high intent)
  if (acts.some(a => a.activity_type === 'whatsapp')) { score += 10; reasons.push('Engaged on WhatsApp') }

  // Walked in / signed in physically (very high intent)
  if (signins.some(s => s.matched_lead_id === lead.id)) { score += 25; reasons.push('Signed in / walked in') }

  // Has a specific course interest
  if (lead.course_interest) { score += 8; reasons.push('Specific course interest') }

  // Source quality
  if (['referral', 'walk_in'].includes(lead.source)) { score += 12; reasons.push(`High-quality source (${lead.source})`) }

  // Clamp
  score = Math.max(0, Math.min(100, score))
  const label = score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold'
  return { score, label, reasons: reasons.slice(0, 4) }
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const safe = async (q: any) => { try { return await q } catch { return { data: [] } } }
  const [leadsRes, activitiesRes, signinsRes] = await Promise.all([
    safe(sb.from('leads').select('id, status, source, course_interest, created_at').limit(3000)),
    safe(sb.from('lead_activities').select('lead_id, activity_type, created_at').limit(5000)),
    safe(sb.from('external_signins').select('matched_lead_id')),
  ])
  const leads = leadsRes.data
  const activities = activitiesRes.data

  const signins = (signinsRes as any).data || []
  let hot = 0, warm = 0, cold = 0

  for (const lead of leads || []) {
    const { score, label, reasons } = scoreLead(lead, activities || [], signins)
    if (label === 'hot') hot++; else if (label === 'warm') warm++; else cold++
    await sb.from('leads').update({
      score, score_label: label, score_reasons: reasons, last_scored_at: new Date().toISOString(),
    }).eq('id', lead.id)
  }

  return NextResponse.json({ success: true, scored: leads?.length || 0, hot, warm, cold })
}
