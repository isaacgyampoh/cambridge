import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'

/**
 * After an info session has passed, message everyone who joined — through the
 * SAME marketer line they came in on — asking if it was clear and offering
 * more info. Their reply is handled by the WhatsApp AI, which hands off to the
 * attributed marketer if they want to go further.
 */
export async function runInfoSessionFollowups() {
  const sb = createServiceClient()
  const now = Date.now()

  // Sessions that have started/passed but not yet followed up
  const { data: sessions } = await sb.from('info_sessions')
    .select('id, title, scheduled_at, followup_sent')
    .eq('status', 'sent').eq('followup_sent', false)
    .limit(20)

  let totalSent = 0
  for (const s of sessions || []) {
    // Only follow up once the session time has passed (+30 min buffer)
    if (new Date(s.scheduled_at).getTime() + 30 * 60000 > now) continue

    const { data: joins } = await sb.from('info_session_joins')
      .select('id, phone, marketer_id, lead_id, followed_up')
      .eq('session_id', s.id).eq('followed_up', false).limit(2000)

    for (const j of joins || []) {
      if (!j.phone) continue
      const msg = `Hi! Thanks for joining our "${s.title}" session today. Was everything clear? If you'd like more details or have any questions, just reply here — happy to help. 🙂`
      try {
        const ok = await sendWhatsAppText(j.phone, msg, j.marketer_id || null)
        if (ok) {
          await sb.from('info_session_joins').update({ followed_up: true }).eq('id', j.id)
          totalSent++
        }
      } catch {}
    }

    await sb.from('info_sessions').update({ followup_sent: true }).eq('id', s.id)
  }

  return { sent: totalSent }
}
