import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS } from '@/lib/integrations/sms'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Consolidated lead-assignment SMS. Hit by the free cron every ~5-15 min:
 *   /api/leads/notify-pending?key=SETUP_SECRET
 * For each marketer with pending assigned leads (settled for 3+ min so bulk
 * batches group together), send ONE SMS with the total count and reset.
 */
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key')
  if (key !== CONFIG.setupSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const settleCutoff = new Date(Date.now() - 3 * 60000).toISOString()  // last lead 3+ min ago

  const { data: pendings } = await sb.from('lead_assign_pending')
    .select('marketer_id, pending, last_lead_at')
    .gt('pending', 0)
    .lte('last_lead_at', settleCutoff)
    .limit(200)

  if (!pendings?.length) return NextResponse.json({ ran: true, sent: 0 })

  const portal = CONFIG.appUrl
  let sent = 0
  for (const p of pendings) {
    const { data: profile } = await sb.from('profiles').select('full_name, phone').eq('id', p.marketer_id).maybeSingle()
    if (!profile?.phone) { await sb.from('lead_assign_pending').update({ pending: 0 }).eq('marketer_id', p.marketer_id); continue }

    const n = p.pending
    const first = (profile.full_name || 'there').split(' ')[0]
    const msg = n === 1
      ? `Hi ${first}, you've been assigned a new lead. Check your portal: ${portal}/marketer/leads`
      : `Hi ${first}, you've been assigned ${n} new leads. Check your portal: ${portal}/marketer/leads`

    try {
      const ok = await sendSMS(profile.phone, msg)
      if (ok) sent++
    } catch {}
    // Reset regardless (avoid a stuck loop re-texting)
    await sb.from('lead_assign_pending').update({ pending: 0, last_sms_at: new Date().toISOString() }).eq('marketer_id', p.marketer_id)
  }

  return NextResponse.json({ ran: true, sent })
}
