import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { intakeLead } from '@/lib/leadIntake'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { flyer_id, full_name, phone, email, course_interest } = await req.json()
  if (!full_name?.trim() || (!phone?.trim() && !email?.trim())) {
    return NextResponse.json({ error: 'Name and a phone or email are required.' }, { status: 400 })
  }
  const sb = createServiceClient()
  const { data: flyer } = await sb.from('flyers').select('marketer_id, course').eq('id', flyer_id).maybeSingle()
  if (!flyer) return NextResponse.json({ error: 'Flyer not found.' }, { status: 404 })

  const { leadId, assignedTo, duplicate } = await intakeLead({
    full_name, phone, email,
    course_interest: course_interest || flyer.course,
    source: 'referral',
    utm_source: 'flyer',
    utm_campaign: 'flyer',
    preferredMarketerId: flyer.marketer_id,   // assign straight to the flyer's owner
    extra: { referrer_name: 'Flyer' },
    raw_payload: { flyer_id },
  })

  if (leadId && !duplicate) {
    try {
      const { data: f } = await sb.from('flyers').select('leads').eq('id', flyer_id).maybeSingle()
      await sb.from('flyers').update({ leads: (f?.leads || 0) + 1 }).eq('id', flyer_id)
    } catch {}
  }
  return NextResponse.json({ success: true, leadId, assignedTo, duplicate })
}
