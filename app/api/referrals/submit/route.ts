import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { intakeLead } from '@/lib/leadIntake'
import { lookup, unavailable } from '@/lib/db/lookup'

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
    const { row: rc, failed } = await lookup(
      sb.from('referral_codes').select('*').eq('code', code).maybeSingle(),
    )
    if (failed) return unavailable('[referrals/submit]', failed, 'that referral link')
    if (rc) { referrerName = rc.referrer_name; validCode = rc.code }
  }

  /*
   * If this came from a marketer's personal link (?m=CODE), resolve that
   * marketer so the lead is assigned straight to them, not by lottery.
   *
   * ── WHY A FAILED READ STOPS EVERYTHING ───────────────────────────────────
   *
   * This failed open. `m` came back null on a blip exactly as it does for an
   * unknown code, so preferredMarketerId stayed null and the lead went to the
   * weighted lottery instead — credited to somebody who had nothing to do
   * with it, while the marketer whose link was actually used got nothing.
   * Nothing about that looks wrong afterwards: the lead is assigned, the
   * source says referral, and the commission is simply on the wrong name.
   *
   * Nothing has been created yet at this point, so stopping costs a retry and
   * loses nobody. Creating the lead under the wrong owner cannot be undone by
   * the person it was taken from, because they will never know.
   */
  let preferredMarketerId: string | null = null
  let marketerName: string | null = null
  if (marketerCode) {
    const { row: m, failed } = await lookup(
      sb.from('profiles').select('id, full_name').eq('marketer_code', marketerCode).maybeSingle(),
    )
    if (failed) return unavailable('[referrals/submit]', failed, 'that referral link')
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

  /*
   * ── WHAT A STRANGER IS TOLD ──────────────────────────────────────────────
   *
   * This returned `leadId` and `assignedTo` — the lead's database id and a
   * marketer's profile id — to an unauthenticated caller on a public form.
   * Neither caller ever used them: /refer and the flyer landing page both
   * read `success` and nothing else. They were internal identifiers handed to
   * anybody who posted the form, and an id that is known can be guessed at
   * elsewhere.
   *
   * `duplicate` goes too. It answers "is this phone number already in your
   * system?" for whoever asks, which is not a question a public endpoint
   * should answer about somebody else.
   */
  if (!leadId) {
    return NextResponse.json(
      { error: 'We could not record your details just now. Please try again in a moment.' },
      { status: 503 },
    )
  }
  return NextResponse.json({ success: true })
}
