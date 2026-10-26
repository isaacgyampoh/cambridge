import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyStudent, STUDENT_COOKIE } from '@/lib/student/auth'
import { SECRETS } from '@/lib/config.server'
import { chargeBreakdown, isPayableAmount } from '@/lib/payments/serviceCharge'

export const runtime = 'nodejs'

/**
 * Start a Paystack payment from inside the student portal.
 *
 * ── THE AMOUNT THE STUDENT TYPES IS THE AMOUNT THEIR FEE IS CREDITED ───────
 *
 * They are charged 1% more than that, which covers taking the payment. The
 * two figures travel separately from here: the gateway collects the gross,
 * and the base and the charge go in the metadata so the webhook credits the
 * fee ledger with the base alone.
 *
 * Doing it the other way — crediting whatever Paystack collected — would
 * clear a GHS 1,000 balance with GHS 1,010 and leave every student who pays
 * a few cedis in credit.
 *
 * The breakdown is computed HERE, not taken from the browser, and returned so
 * the screen can show the same figures the gateway will.
 */
export async function POST(req: NextRequest) {
  const s = await verifyStudent(req.cookies.get(STUDENT_COOKIE)?.value)
  if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { amount } = await req.json().catch(() => ({}))
  if (!isPayableAmount(amount)) {
    return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
  }
  const { base, charge, gross } = chargeBreakdown(Number(amount))

  const secret = SECRETS.paystackSecretKey
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
        email,
        // The gross: what the payer is charged.
        amount: Math.round(gross * 100),
        currency: 'GHS', reference,
        channels: ['mobile_money', 'card'],
        callback_url: `${new URL(req.url).origin}/portal`,
        /*
         * Set by us and signed by Paystack along with the rest of the event,
         * so the webhook can trust it. base_amount is what the fee ledger is
         * credited; service_charge is what the 1% came to.
         */
        metadata: {
          lead_id: s.leadId,
          purpose: 'course_fee',
          base_amount: base,
          service_charge: charge,
        },
      }),
    })
    const data = await res.json()
    if (!data.status) return NextResponse.json({ error: data.message || 'Paystack rejected the request.' }, { status: 400 })
    return NextResponse.json({
      success: true,
      authorization_url: data.data.authorization_url,
      reference,
      // So the screen states the same total the gateway will ask for.
      base, serviceCharge: charge, total: gross,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not reach Paystack.' },
      { status: 500 },
    )
  }
}
