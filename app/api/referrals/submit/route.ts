import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { intakeLead } from '@/lib/leadIntake'

export const runtime = 'nodejs'

/** Public: a referred friend submits their details via a referral link. */
export async function POST(req: NextRequest) {
  const { code, marketerCode, full_name, phone, email, course_interest } = await req.json()
  if (!full_name?.trim() || (!phone?.trim() && !email?.trim())) {
    return NextResponse.json({ error: 'Name and a phone or email are required.' }, { status: 400 })
  }

  const sb = createServiceClient()
  let referrerName: string | null = null
  let validCode: string | null = null

  if (code) {
    const { data: rc } = await sb.from('referral_codes').select('*').eq('code', code).maybeSingle()
    if (rc) { referrerName = rc.referrer_name; validCode = rc.code }
  }

  // If this came from a marketer's personal link (?m=CODE), resolve that
  // marketer so the lead is assigned straight to them (not round-robin).
  let preferredMarketerId: string | null = null
  let marketerName: string | null = null
  if (marketerCode) {
    const { data: m } = await sb.from('profiles').select('id, full_name').eq('marketer_code', marketerCode).maybeSingle()
    if (m) { preferredMarketerId = m.id; marketerName = m.full_name }
  }

  // Create the lead (assigns to the marketer if given, else round-robin)
  const { leadId, assignedTo, duplicate } = await intakeLead({
    full_name, phone, email, course_interest,
    source: 'referral',
    utm_source: 'referral',
    utm_campaign: validCode || marketerCode || 'referral',
    utm_content: marketerCode || null,
    preferredMarketerId,
    extra: { referral_code: validCode, referrer_name: referrerName || marketerName },
    raw_payload: { code, marketerCode, referrerName },
  })

  // Bump the referrer's count (only for code-based generic referrals)
  if (validCode && leadId && !duplicate) {
    try {
      const { data: rc } = await sb.from('referral_codes').select('id, referrals_count').eq('code', validCode).maybeSingle()
      if (rc) await sb.from('referral_codes').update({ referrals_count: (rc.referrals_count || 0) + 1 }).eq('id', rc.id)
    } catch {}
  }

  return NextResponse.json({ success: true, leadId, assignedTo, duplicate })
}
