import { NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Returns the Paystack PUBLIC key from the server, where env vars are readable.
 * The client can't read a non-NEXT_PUBLIC_ env var, so it fetches the key here
 * at payment time — ensuring whatever key is set in Vercel is the one used.
 */
export async function GET() {
  const key = CONFIG.paystackPublicKey || ''
  return NextResponse.json({
    key,
    live: key.startsWith('pk_live_'),
    // a short fingerprint so you can confirm WHICH key is live without exposing it
    fingerprint: key ? `${key.slice(0, 12)}…${key.slice(-4)}` : null,
  })
}
