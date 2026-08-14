import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { claimJob, markSent } from '@/lib/messageJobs'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Follow up with leads who were sent the gallery and brochure but have not
 * replied. Runs 20 minutes to 3 hours after, so it lands while they still
 * remember, without crowding them.
 * Cron: /api/leads/followup?key=SECRET  (every 10 minutes)
 */
export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get('key') !== CONFIG.setupSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createServiceClient()
  const now = Date.now()

  // Leads sent the brochure between 20 minutes and 3 hours ago.
  const { data: sends } = await sb.from('lead_sends')
    .select('lead_id, sent_at').eq('kind', 'brochure')
    .lte('sent_at', new Date(now - 20 * 60000).toISOString())
    .gte('sent_at', new Date(now - 180 * 60000).toISOString())
    .limit(200)

  let sent = 0
  for (const s of sends || []) {
    // Skip anyone who has already replied — they do not need chasing.
    const { count: replies } = await sb.from('ai_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', s.lead_id).not('incoming_text', 'is', null)
    if (replies && replies > 0) continue

    const { data: lead } = await sb.from('leads')
      .select('id, full_name, phone, course_interest, assigned_to, status, ai_paused')
      .eq('id', s.lead_id).maybeSingle()
    if (!lead?.phone || lead.ai_paused) continue
    if (['registered', 'not_interested', 'lost'].includes(String(lead.status || ''))) continue

    const key = `followup_1:${lead.id}`
    if (!(await claimJob({ dedupeKey: key, leadId: lead.id, phone: lead.phone, kind: 'followup' }))) continue

    const first = (lead.full_name || '').split(' ')[0] || 'there'
    const course = lead.course_interest || 'the programme'
    const msg = `Hi ${first}, I hope you're doing well. I sent you our gallery and the ${course} brochure earlier. I'd like to know what you do, so I can show you how it fits your role before we talk about registration.`

    const ok = await sendWhatsAppText(lead.phone, msg, lead.assigned_to || null)
    await markSent(key, ok)
    if (ok) {
      sent++
      await sb.from('ai_conversations').insert({
        phone: lead.phone, lead_id: lead.id, marketer_id: lead.assigned_to || null,
        incoming_text: null, reply_text: msg, answered_by: 'ai_followup',
      }).then(() => {}, () => {})
      await sb.from('lead_sends').upsert({ lead_id: lead.id, kind: 'followup' }, { onConflict: 'lead_id,kind' }).then(() => {}, () => {})
    }
  }

  return NextResponse.json({ ran: true, sent })
}
