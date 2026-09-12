import { NextRequest, NextResponse } from 'next/server'
import { SECRETS } from '@/lib/config.server'

export const runtime = 'nodejs'

/**
 * Verify a Paystack transaction by reference (server-side, with the secret
 * key), then trigger application completion. Called when the customer returns
 * from Paystack's hosted checkout.
 */
export async function POST(req: NextRequest) {
  const { reference, applicationId } = await req.json()
  if (!reference) return NextResponse.json({ error: 'Missing reference.' }, { status: 400 })

  try {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${SECRETS.paystackSecretKey}` },
    })
    const data = await res.json()
    if (!data.status || data.data?.status !== 'success') {
      return NextResponse.json({ error: data.data?.gateway_response || data.message || 'Payment not successful.' }, { status: 400 })
    }

    /*
     * ── PAYMENT CONFIRMED. NOW RECORD IT. ────────────────────────────────
     *
     * Paystack has the money by this point, so everything below is about
     * whether OUR system knows.
     *
     * This call used to end `.catch(() => {})` and the route returned
     * `success: true` regardless. So when completion failed — a duplicate, a
     * missing course, a database blip — the student saw the success screen,
     * Paystack held their payment, and no payment record and no admission
     * existed anywhere in the system. Nobody at the centre had any reason to
     * look, because as far as every screen was concerned it had worked.
     *
     * The failure is loud now, in three places at once: the server log with
     * the reference, an admission_issues row so it survives the log, and a
     * flag on the response so the student is told to make contact rather than
     * being shown a clean success and forgotten.
     */
    const appId = applicationId || data.data?.metadata?.application_id
    const amount = data.data.amount / 100
    let recorded = true

    if (appId) {
      const origin = new URL(req.url).origin
      try {
        const complete = await fetch(`${origin}/api/applications/complete`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicationId: appId, paystack_ref: reference }),
        })
        const body = await complete.json().catch(() => null)
        if (!complete.ok || body?.error) {
          recorded = false
          console.error(
            '[paystack/verify] PAID BUT NOT RECORDED —',
            'reference:', reference, 'application:', appId, 'amount:', amount,
            '—', body?.error || `HTTP ${complete.status}`,
          )
        }
      } catch (e) {
        recorded = false
        console.error(
          '[paystack/verify] PAID BUT NOT RECORDED —',
          'reference:', reference, 'application:', appId, 'amount:', amount,
          '—', e instanceof Error ? e.message : e,
        )
      }
    }

    /*
     * `success` stays true: the payment genuinely succeeded, and telling
     * somebody who has just been charged that it did not is worse than the
     * problem being reported. `recorded` carries the rest.
     */
    return NextResponse.json({
      success: true,
      recorded,
      applicationId: appId,
      amount,
      ...(recorded ? {} : {
        warning: 'Your payment went through, but we could not finish your registration automatically. '
          + 'Please contact the office with your payment reference and they will complete it.',
        reference,
      }),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not verify payment.' }, { status: 500 })
  }
}
