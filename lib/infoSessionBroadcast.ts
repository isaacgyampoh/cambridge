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

  // Audience — include the lead's assigned marketer so their join link is
  // routed through (attributed to) the right person.
  let q: any = sb.from('leads').select('id, full_name, phone, email, assigned_to').not('phone', 'is', null)
  if (s.audience === 'uncontacted') q = q.eq('status', 'new')
  else if (s.audience === 'interested') q = q.in('status', ['interested', 'follow_up'])
  else q = q.not('status', 'in', '(registered,lost,not_interested)')
  const { data: leads } = await q.limit(5000)

  // Marketer codes -> per-lead tracked join links
  const { data: allMarketers } = await sb.from('profiles').select('id, marketer_code').not('marketer_code', 'is', null)
  const codeById: Record<string, string> = {}
  for (const m of allMarketers || []) codeById[m.id] = m.marketer_code
  const appUrl = process.env.APP_URL || 'https://portal.cambridge.edu.gh'
  const trackedFor = (lead: any) => {
    const code = lead.assigned_to ? (codeById[lead.assigned_to] || 'x') : 'x'
    return `${appUrl}/j/${s.id}/${code}?p=${encodeURIComponent(lead.phone)}`
  }

  const when = new Date(s.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const channels = (s.channels || 'sms,whatsapp').split(',')

  let notified = 0
  for (const lead of leads || []) {
    const first = (lead.full_name || 'there').split(' ')[0]
    const joinLink = trackedFor(lead)
    const msg = `Hi ${first}, you're invited to Cambridge Centre of Excellence's "${s.title}" on ${when}.\nJoin here: ${joinLink}${s.description ? `\n${s.description}` : ''}`
    let ok = false
    try { if (channels.includes('whatsapp')) ok = await sendWhatsAppText(lead.phone, msg, lead.assigned_to || null) || ok } catch {}
    try { if (channels.includes('sms')) ok = await sendSMS(lead.phone, msg) || ok } catch {}
    try {
      if (channels.includes('email') && lead.email) {
        const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#1a2230">
          <p style="font-size:15px;line-height:1.6">Hi ${first},</p>
          <p style="font-size:15px;line-height:1.6">You're invited to <b>${s.title}</b> at Cambridge Centre of Excellence on <b>${when}</b>.</p>
          ${s.description ? `<p style="font-size:14px;color:#5a6675;line-height:1.6">${s.description}</p>` : ''}
          <p style="margin:18px 0"><a href="${joinLink}" style="background:#1a7a85;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">Join the session</a></p>
          <p style="font-size:13px;color:#97a1b0">Or copy this link: ${joinLink}</p>
        </div>`
        ok = await sendEmail(lead.email, `You're invited: ${s.title} — Cambridge CE`, html, `You're invited to ${s.title} on ${when}. Join: ${joinLink}`) || ok
      }
    } catch {}
    if (ok) notified++
  }

  // Push a link to marketers. Each marketer gets THEIR OWN tracked version
  // (/j/{session}/{their_code}) so anyone who joins through their share — even
  // a stranger from their status — is attributed to them, and they can see
  // their own join count. The shared_links row shows a generic version.
  let marketersNotified = 0
  try {
    await sb.from('shared_links').insert({
      title: `Info session: ${s.title}`, url: `${appUrl}/j/${s.id}/x`, link_type: 'info_session',
      description: `Session on ${when}. Your personal share link is on your My Links page.`,
      audience: 'marketers', posted_by: s.created_by, expires_at: s.scheduled_at,
    })
    const { data: marketers } = await sb.from('profiles').select('id, marketer_code').eq('is_active', true).neq('role', 'super_admin').limit(500)
    for (const m of marketers || []) {
      const personal = `${appUrl}/j/${s.id}/${m.marketer_code || 'x'}`
      try {
        await sb.from('notifications').insert({
          user_id: m.id, type: 'info_session',
          title: `New info session: ${s.title}`,
          body: `Share your personal link so joins count for you: ${personal}`,
          data: { link: personal },
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
