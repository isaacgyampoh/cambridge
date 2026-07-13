import { NextRequest, NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Initialize a Paystack transaction SERVER-SIDE (recommended by Paystack).
 * Returns the hosted checkout URL + reference. This avoids the inline popup's
 * "invalid merchant selected" ambiguity: if anything is wrong (key, currency,
 * amount) Paystack returns a clear message we can surface.
 *
 * Body: { email, amount (GHS), reference, metadata? }
 */
export async function POST(req: NextRequest) {
  const { email, amount, reference, metadata } = await req.json()
  if (!email || !amount) {
    return NextResponse.json({ error: 'Email and amount are required.' }, { status: 400 })
  }

  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(Number(amount) * 100), // pesewas
        currency: 'GHS',
        reference,
        metadata,
        channels: ['mobile_money', 'card'],
      }),
    })
    const data = await res.json()
    if (!data.status) {
      // Paystack tells us exactly what's wrong here
      return NextResponse.json({ error: data.message || 'Paystack rejected the request.' }, { status: 400 })
    }
    return NextResponse.json({
      success: true,
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not reach Paystack.' }, { status: 500 })
  }
}
