import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { intakeLead } from '@/lib/leadIntake'
import { lookup, unavailable } from '@/lib/db/lookup'
import { bumpCounter } from '@/lib/db/counter'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { flyer_id, full_name, phone, email, course_interest } = await req.json()
  if (!full_name?.trim() || (!phone?.trim() && !email?.trim())) {
    return NextResponse.json({ error: 'Name and a phone or email are required.' }, { status: 400 })
  }
  const sb = createServiceClient()
  // flyer.marketer_id is the attribution for the lead created below. Reading
  // it wrongly as absent would turn away somebody trying to enquire.
  const { row: flyer, failed } = await lookup(
    sb.from('flyers').select('marketer_id, course').eq('id', flyer_id).maybeSingle(),
  )
  if (failed) return unavailable('[flyers/submit]', failed, 'this flyer')
  if (!flyer) return NextResponse.json({ error: 'Flyer not found.' }, { status: 404 })

  const { leadId, duplicate } = await intakeLead({
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
      // Atomic, and never written from a total that could not be read —
      // the old form reset a flyer's lead count to 1 on a failed read.
      await bumpCounter({ table: 'flyers', column: 'leads' }, flyer_id)
    } catch {}
  }

  // No database ids to a public caller: the landing page reads `success` and
  // nothing else, and `duplicate` would answer "is this number already in
  // your system?" for anybody who asked.
  if (!leadId) {
    return NextResponse.json(
      { error: 'We could not record your details just now. Please try again in a moment.' },
      { status: 503 },
    )
  }
  return NextResponse.json({ success: true })
}
