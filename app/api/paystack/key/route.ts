import { NextResponse } from 'next/server'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Diagnostic: shows what keys the SERVER actually sees, without exposing the
 * full secret. Use this to confirm the Vercel env vars are set + deployed.
 */
export async function GET() {
  const pub = CONFIG.paystackPublicKey || ''
  const sec = CONFIG.paystackSecretKey || ''
  return NextResponse.json({
    public_key_set: !!pub,
    public_key_fingerprint: pub ? `${pub.slice(0, 12)}…${pub.slice(-4)}` : null,
    public_is_live: pub.startsWith('pk_live_'),
    secret_key_set: !!sec,
    secret_key_fingerprint: sec ? `${sec.slice(0, 11)}…${sec.slice(-4)}` : null,
    secret_is_live: sec.startsWith('sk_live_'),
    secret_length: sec.length,
    // What Paystack expects: a live secret is ~51 chars starting sk_live_
    diagnosis: !sec
      ? 'SECRET KEY IS EMPTY — set PAYSTACK_SECRET_KEY in Vercel and redeploy.'
      : !sec.startsWith('sk_live_')
        ? 'Secret key is set but does NOT start with sk_live_ — wrong value or has a space.'
        : 'Secret key looks valid. If payment still fails, verify it matches your Paystack dashboard.',
  })
}
