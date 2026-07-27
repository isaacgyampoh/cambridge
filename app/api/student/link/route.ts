import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createLoginToken, normalisePhone } from '@/lib/student/auth'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { sendSMS } from '@/lib/integrations/sms'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Send a student their portal link. PUBLIC: a student can request it by
 * entering their own phone number; the link only ever goes to that number.
 * Body: { phone } or { leadId }
 */
export async function POST(req: NextRequest) {
  const { phone, leadId } = await req.json().catch(() => ({}))
  const sb = createServiceClient()

  let lead: any = null
  if (leadId) {
    const { data } = await sb.from('leads').select('id, full_name, phone, assigned_to').eq('id', leadId).maybeSingle()
    lead = data
  } else if (phone) {
    const { data } = await sb.from('leads')
      .select('id, full_name, phone, assigned_to').in('phone', normalisePhone(phone))
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    lead = data
  }

  // Never reveal whether a number exists — always answer the same way.
  if (!lead?.phone) return NextResponse.json({ success: true })

  const token = await createLoginToken(lead.id, lead.phone)
  const url = `${CONFIG.appUrl}/portal/enter?t=${token}`
  const first = (lead.full_name || 'there').split(' ')[0]
  const msg = `Hi ${first}! 👋 Here is your Cambridge Center of Excellence student portal:\n\n${url}\n\nTap it to open, then add it to your home screen so it works like an app. From there you can join your class, get your course materials, and check your balance.`

  let ok = false
  try { ok = !!(await sendWhatsAppText(lead.phone, msg, lead.assigned_to || null)) } catch {}
  if (!ok) { try { await sendSMS(lead.phone, msg) } catch {} }

  return NextResponse.json({ success: true })
}
