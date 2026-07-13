import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'

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
      headers: { Authorization: `Bearer ${CONFIG.paystackSecretKey}` },
    })
    const data = await res.json()
    if (!data.status || data.data?.status !== 'success') {
      return NextResponse.json({ error: data.data?.gateway_response || data.message || 'Payment not successful.' }, { status: 400 })
    }

    // Payment confirmed — complete the application (records payment + admission)
    const appId = applicationId || data.data?.metadata?.application_id
    if (appId) {
      const origin = new URL(req.url).origin
      await fetch(`${origin}/api/applications/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: appId, paystack_ref: reference }),
      }).catch(() => {})
    }
    return NextResponse.json({ success: true, applicationId: appId, amount: data.data.amount / 100 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not verify payment.' }, { status: 500 })
  }
}
