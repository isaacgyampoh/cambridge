import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { sendEmail } from '@/lib/integrations/email'

/**
 * Broadcast one info session: SMS / WhatsApp / email every targeted lead,
 * push the link to all marketers, mark it sent. Shared by the scheduled cron
 * runner AND the manual "send now" action so the behaviour is identical.
 */
export async function broadcastInfoSession(sessionId: string) {
  const sb = createServiceClient()
  const { data: s } = await sb.from('info_sessions').select('*').eq('id', sessionId).maybeSingle()
  if (!s || s.status !== 'scheduled') return { error: 'Session not found or already sent.' }

  // Audience
  let q: any = sb.from('leads').select('full_name, phone, email').not('phone', 'is', null)
  if (s.audience === 'uncontacted') q = q.eq('status', 'new')
  else if (s.audience === 'interested') q = q.in('status', ['interested', 'follow_up', 'ready_to_join'])
  else q = q.not('status', 'in', '(registered,lost,not_interested)')
  const { data: leads } = await q.limit(5000)

  const when = new Date(s.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const channels = (s.channels || 'sms,whatsapp').split(',')

  let notified = 0
  for (const lead of leads || []) {
    const first = (lead.full_name || 'there').split(' ')[0]
    const msg = `Hi ${first}, you're invited to Cambridge Centre of Excellence's "${s.title}" on ${when}.\nJoin here: ${s.link}${s.description ? `\n${s.description}` : ''}`
    let ok = false
    try { if (channels.includes('whatsapp')) ok = await sendWhatsAppText(lead.phone, msg) || ok } catch {}
    try { if (channels.includes('sms')) ok = await sendSMS(lead.phone, msg) || ok } catch {}
    try {
      if (channels.includes('email') && lead.email) {
        const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#1a2230">
          <p style="font-size:15px;line-height:1.6">Hi ${first},</p>
          <p style="font-size:15px;line-height:1.6">You're invited to <b>${s.title}</b> at Cambridge Centre of Excellence on <b>${when}</b>.</p>
          ${s.description ? `<p style="font-size:14px;color:#5a6675;line-height:1.6">${s.description}</p>` : ''}
          <p style="margin:18px 0"><a href="${s.link}" style="background:#1a7a85;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">Join the session</a></p>
          <p style="font-size:13px;color:#97a1b0">Or copy this link: ${s.link}</p>
        </div>`
        ok = await sendEmail(lead.email, `You're invited: ${s.title} — Cambridge CE`, html, `You're invited to ${s.title} on ${when}. Join: ${s.link}`) || ok
      }
    } catch {}
    if (ok) notified++
  }

  // Push link to marketers
  let marketersNotified = 0
  try {
    await sb.from('shared_links').insert({
      title: `Info session: ${s.title}`, url: s.link, link_type: 'info_session',
      description: `Session on ${when}. Share with your leads.`,
      audience: 'marketers', posted_by: s.created_by, expires_at: s.scheduled_at,
    })
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

  await sb.from('info_sessions').update({
    status: 'sent', sent_at: new Date().toISOString(),
    leads_notified: notified, marketers_notified: marketersNotified,
  }).eq('id', s.id)

  return { leads_notified: notified, marketers_notified: marketersNotified, title: s.title }
}
