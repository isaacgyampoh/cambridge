import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function makeCode(name: string) {
  const base = (name || 'CCE').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'CCE'
  return base + Math.random().toString(36).slice(2, 6).toUpperCase()
}

/** Public: a person enters their details and gets a shareable referral code. */
export async function POST(req: NextRequest) {
  const { name, phone, email } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Your name is required.' }, { status: 400 })

  const sb = createServiceClient()

  // Reuse an existing code for the same phone/email if we have one
  if (phone || email) {
    let q = sb.from('referral_codes').select('*')
    if (phone) q = q.eq('referrer_phone', phone.trim())
    const { data: existing } = await q.limit(1)
    if (existing?.[0]) return NextResponse.json({ code: existing[0].code, existing: true })
  }

  let code = makeCode(name)
  // ensure uniqueness
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await sb.from('referral_codes').select('id').eq('code', code).maybeSingle()
    if (!clash) break
    code = makeCode(name)
  }

  const { data, error } = await sb.from('referral_codes').insert({
    code, referrer_name: name.trim(),
    referrer_phone: phone?.trim() || null, referrer_email: email?.trim() || null,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ code: data.code })
}
