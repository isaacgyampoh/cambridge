import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyStudent, STUDENT_COOKIE } from '@/lib/student/auth'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/** Start a Paystack payment from inside the student portal. */
export async function POST(req: NextRequest) {
  const s = await verifyStudent(req.cookies.get(STUDENT_COOKIE)?.value)
  if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { amount } = await req.json().catch(() => ({}))
  const amt = Number(amount)
  if (!(amt > 0)) return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })

  const secret = CONFIG.paystackSecretKey
  if (!secret) return NextResponse.json({ error: 'Payment is not configured yet.' }, { status: 500 })

  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads').select('id, full_name, email, phone').eq('id', s.leadId).maybeSingle()
  const email = lead?.email || `${String(lead?.phone || 'student').replace(/\D/g, '')}@cce.edu.gh`
  const reference = `CCE-STU-${s.leadId}-${Date.now()}`

  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, amount: Math.round(amt * 100), currency: 'GHS', reference,
        channels: ['mobile_money', 'card'],
        callback_url: `${new URL(req.url).origin}/portal`,
        metadata: { lead_id: s.leadId, purpose: 'course_fee' },
      }),
    })
    const data = await res.json()
    if (!data.status) return NextResponse.json({ error: data.message || 'Paystack rejected the request.' }, { status: 400 })
    return NextResponse.json({ success: true, authorization_url: data.data.authorization_url, reference })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not reach Paystack.' }, { status: 500 })
  }
}
