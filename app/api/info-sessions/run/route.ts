import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Info-session auto-broadcast runner.
 * Called by the SAME external cron you already use (cron-job.org), e.g.
 *   /api/info-sessions/run?key=SETUP_SECRET   every 15 minutes.
 *
 * For each scheduled session whose notify_at has passed:
 *   - SMS + WhatsApp every targeted lead the session details + link
 *   - push the link to every marketer's "My Links" (shared_links) so they post it
 *   - mark the session sent (so it never double-sends)
 *
 * No Supabase cron or paid tier needed — this is just an HTTP endpoint the
 * free external cron pings.
 */
export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key')
  if (key !== CONFIG.setupSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const now = new Date().toISOString()

  // Sessions due to be sent
  const { data: due } = await sb.from('info_sessions')
    .select('*').eq('status', 'scheduled').lte('notify_at', now).limit(5)

  if (!due?.length) return NextResponse.json({ ran: true, sessions: 0 })

  const results: any[] = []

  for (const s of due) {
    // Build the lead audience
    let q: any = sb.from('leads').select('full_name, phone').not('phone', 'is', null)
    if (s.audience === 'uncontacted') q = q.eq('status', 'new')
    else if (s.audience === 'interested') q = q.in('status', ['interested', 'follow_up', 'ready_to_join'])
    else q = q.not('status', 'in', '(registered,lost,not_interested)') // all_leads (active)
    const { data: leads } = await q.limit(5000)

    const when = new Date(s.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    const channels = (s.channels || 'sms,whatsapp').split(',')

    let notified = 0
    for (const lead of leads || []) {
      const first = (lead.full_name || 'there').split(' ')[0]
      const msg = `Hi ${first}, you're invited to Cambridge Centre of Excellence's "${s.title}" on ${when}.\nJoin here: ${s.link}${s.description ? `\n${s.description}` : ''}`
      let ok = false
      try {
        if (channels.includes('whatsapp')) ok = await sendWhatsAppText(lead.phone, msg) || ok
      } catch {}
      try {
        if (channels.includes('sms')) ok = await sendSMS(lead.phone, msg) || ok
      } catch {}
      if (ok) notified++
    }

    // Push the link to all marketers' "My Links"
    let marketersNotified = 0
    try {
      await sb.from('shared_links').insert({
        title: `Info session: ${s.title}`,
        url: s.link,
        link_type: 'info_session',
        description: `Session on ${when}. Share with your leads.`,
        audience: 'marketers',
        posted_by: s.created_by,
        expires_at: s.scheduled_at,
      })
      // Notify each marketer in-app
      const { data: marketers } = await sb.from('profiles').select('id').eq('is_active', true).neq('role', 'super_admin').limit(500)
      for (const m of marketers || []) {
        try {
          await sb.from('notifications').insert({
            user_id: m.id, type: 'info_session',
            title: `New info session: ${s.title}`,
            body: `Share this link with your leads: ${s.link}`,
            data: { link: s.link },
          })
          marketersNotified++
        } catch {}
      }
    } catch {}

    // Mark sent (so it never double-sends)
    await sb.from('info_sessions').update({
      status: 'sent', sent_at: new Date().toISOString(),
      leads_notified: notified, marketers_notified: marketersNotified,
    }).eq('id', s.id)

    results.push({ session: s.title, leads_notified: notified, marketers_notified: marketersNotified })
  }

  return NextResponse.json({ ran: true, sessions: results.length, results })
}
