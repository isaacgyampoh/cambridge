import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { chargeBreakdown } from '@/lib/payments/serviceCharge'
import { registrationBase } from '@/lib/payments/registrationFee'

export const runtime = 'nodejs'

/**
 * Public: active course names, for the dropdowns on public forms.
 *
 * ── WHY THIS ROUTE NOW REPORTS FAILURE ─────────────────────────────────────
 *
 * It read `const { data } = await sb.from('courses')...` and returned
 * `data || []`, discarding the error. So a database that refused the read —
 * an expired service key, a policy change, an outage — produced exactly the
 * same response as a centre with no courses:
 *
 *     { "courses": [], "list": [] }
 *
 * That is not a hypothetical. It is how a previous audit of this system
 * concluded, in writing, that the centre had no active courses. The local
 * service key was invalid, every server-side read was failing with a 401,
 * and three endpoints all answered "empty" in a calm and confident voice.
 * Production had three courses with fees on them the whole time.
 *
 * An empty list is now only ever an empty table. A failed read says so, and
 * the caller can tell the difference.
 *
 * ── IT ALSO CARRIES THE REGISTRATION FEE ───────────────────────────────────
 *
 * The apply page printed "Registration Fee — GHS 200" as a literal, in three
 * places, and sent that 200 to the server as the amount to charge. The figure
 * is settled on the server now, so the page has to be TOLD what it is rather
 * than asserting it — otherwise the page and the gateway can disagree about
 * the price, and the page is the one the applicant read.
 *
 * The 1% service charge is included in the same answer, because a total that
 * appears for the first time on Paystack's own page, a percent above the
 * figure somebody agreed to, is how a payment becomes a chargeback.
 */
export async function GET() {
  const sb = createServiceClient()
  const { data, error } = await sb.from('courses')
    .select('id, name, registration_fee').eq('is_active', true).order('name')

  if (error) {
    console.error('[courses/public] could not read courses:', error.message)
    return NextResponse.json(
      { error: 'The programme list could not be loaded.' },
      { status: 503 },
    )
  }

  const rows = data || []
  return NextResponse.json({
    courses: rows.map(c => c.name),                        // backward-compat: names
    list: rows.map(c => {
      const fee = chargeBreakdown(registrationBase(c).amount)
      return {
        id: c.id,
        name: c.name,
        // What registration costs, as the page should state it.
        registrationFee: fee.base,
        serviceCharge: fee.charge,
        registrationTotal: fee.gross,
      }
    }),
  })
}
