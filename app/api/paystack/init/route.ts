import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { SECRETS } from '@/lib/config.server'
import { chargeBreakdown } from '@/lib/payments/serviceCharge'
import { registrationBase } from '@/lib/payments/registrationFee'
import { lookup } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Start the registration payment for an application, server-side.
 *
 * Paystack's hosted checkout rather than the inline popup: if anything is
 * wrong — the key, the currency, the amount — Paystack answers with a clear
 * message that can be shown to the applicant, instead of the popup's "invalid
 * merchant selected".
 *
 * ── THE AMOUNT IS NOT THE BROWSER'S TO DECIDE ──────────────────────────────
 *
 * This took `amount` from the request body, and the apply page sent a
 * hardcoded 200. Anybody who could open the developer console could register
 * for one cedi: the only thing behind it was the webhook's amount check,
 * which accepts anything when the course has no registration fee recorded.
 *
 * The fee is read from the application's course here. The applicant's email
 * comes from the same record for the same reason — it is the address on the
 * receipt, and it should be the one they applied with.
 *
 * ── AND IT CARRIES THE 1% SEPARATELY ───────────────────────────────────────
 *
 * The payer is charged 1% on top. The gateway collects the gross; the base
 * and the charge travel in the metadata so that what is recorded against the
 * registration is the fee itself, not the fee plus the cost of collecting it.
 *
 * Body: { applicationId, callback_url? }
 */
export async function POST(req: NextRequest) {
  const { applicationId, callback_url } = await req.json().catch(() => ({}))
  if (!applicationId) {
    return NextResponse.json({ error: 'The application could not be identified.' }, { status: 400 })
  }

  const secret = SECRETS.paystackSecretKey
  if (!secret || !secret.startsWith('sk_')) {
    return NextResponse.json(
      { error: 'Payment is not configured on the server. Please contact the centre.' },
      { status: 500 },
    )
  }

  const sb = createServiceClient()
  const { row: app, failed } = await lookup(
    sb.from('applications')
      .select('id, email, full_name, course_id, course:course_id(id, name, registration_fee)')
      .eq('id', applicationId).maybeSingle(),
  )

  /*
   * A failed read is not a missing application. Telling somebody their
   * application does not exist because a query blipped sends them back to
   * fill the form in again, and creates a second application.
   */
  if (failed) {
    console.error('[paystack/init] could not read application', applicationId, '—', failed)
    return NextResponse.json(
      { error: 'We could not start the payment just now. Please try again in a moment.' },
      { status: 503 },
    )
  }
  if (!app) {
    return NextResponse.json({ error: 'That application could not be found.' }, { status: 404 })
  }

  const course = (app as { course?: { name?: string; registration_fee?: number | null } }).course
  const fee = registrationBase(course)
  if (!fee.fromCourse) {
    // Visible rather than silent: a course priced by default instead of by
    // decision is worth correcting on the Courses screen.
    console.warn(
      '[paystack/init] no registration fee recorded for',
      course?.name || app.course_id, '— charging the default.',
    )
  }

  const { base, charge, gross } = chargeBreakdown(fee.amount)
  const email = String(app.email || '').trim()
  if (!email) {
    return NextResponse.json(
      { error: 'This application has no email address, so a payment receipt cannot be issued.' },
      { status: 400 },
    )
  }

  const reference = `CCE-APP-${applicationId}-${Date.now()}`

  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(gross * 100), // pesewas, and the gross
        currency: 'GHS',
        reference,
        metadata: {
          application_id: applicationId,
          purpose: 'registration_fee',
          base_amount: base,
          service_charge: charge,
        },
        callback_url: callback_url || undefined,
        channels: ['mobile_money', 'card'],
      }),
    })
    const data = await res.json()
    if (!data.status) {
      // Paystack tells us exactly what is wrong here.
      return NextResponse.json({ error: data.message || 'Paystack rejected the request.' }, { status: 400 })
    }
    return NextResponse.json({
      success: true,
      authorization_url: data.data.authorization_url,
      reference: data.data.reference || reference,
      // So the page can state the same total the gateway will ask for.
      base, serviceCharge: charge, total: gross,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not reach Paystack.' },
      { status: 500 },
    )
  }
}
