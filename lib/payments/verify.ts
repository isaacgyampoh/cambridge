import 'server-only'
import crypto from 'crypto'
import { SECRETS } from '@/lib/config.server'
import { timingSafeEqualHex } from '@/lib/payments/rules'

export * from '@/lib/payments/rules'

/**
 * Paystack signs the raw body with HMAC-SHA512 using the secret key.
 *
 * The only part of payment verification that needs configuration, which is why
 * it lives apart from the pure rules in lib/payments/rules.ts.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false

  let secret: string
  try {
    secret = SECRETS.paystackSecretKey
  } catch {
    // PAYSTACK_SECRET_KEY is unset. Refuse rather than computing an HMAC with
    // an empty key, which would accept anything an attacker could also compute.
    console.error('[paystack] PAYSTACK_SECRET_KEY is not configured - refusing all webhooks.')
    return false
  }

  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')
  return timingSafeEqualHex(expected, signature)
}
