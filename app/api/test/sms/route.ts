import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { BRAND } from '@/lib/brand'
import { deliverSMS, normaliseRecipient } from '@/lib/integrations/sms'

/**
 * "Is SMS working?" — answered by actually doing what SMS does.
 *
 * ── WHY THIS NO LONGER TALKS TO ARKESEL ITSELF ─────────────────────────────
 *
 * It used to re-implement the whole send: its own copy of the endpoint URL,
 * the headers, the JSON body, the success test, and its own phone
 * normalisation. A diagnostic that reimplements the thing it is diagnosing
 * can only tell you about itself. If the real sender broke — a changed
 * endpoint, a different success field, a sender id nobody registered — this
 * went on reporting "SMS sent successfully", because none of the code it
 * exercised was the code that sends.
 *
 * The three copies had already begun to separate:
 *
 *   - the sender id came from CONFIG.arkeselSenderId (with a third hard-coded
 *     'CambridgeCE' behind it), while real messages went out with
 *     BRAND.smsSender;
 *   - its phone normalisation had no length check, so `0246` became `233246`
 *     and was posted to Arkesel as a recipient. The real one rejects that
 *     before any request is made.
 *
 * ── AND WHY IT USED TO CRASH WHEN IT WAS MOST NEEDED ───────────────────────
 *
 * `SECRETS.arkeselApiKey` throws when ARKESEL_API_KEY is unset, and it was
 * read OUTSIDE the try block. So on a deployment where SMS is not configured
 * — the exact situation somebody presses this button to diagnose — the answer
 * was an unhandled 500 rather than "the API key is not set". deliverSMS
 * reports that case as a permanent failure with a readable reason.
 */

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  let phone = '0201234567'
  try { const body = await req.json(); if (body?.phone) phone = body.phone } catch {}

  // Shown so the operator can see what the provider was actually given. Null
  // means the number never would have been sent, which is itself the answer.
  const recipient = normaliseRecipient(phone)
  if (!recipient) {
    return NextResponse.json({
      success: false,
      sender: BRAND.smsSender,
      recipient: null,
      hint: `"${phone}" is not a Ghanaian mobile number, so no message was attempted. `
        + 'Use the 0XXXXXXXXX or 233XXXXXXXXX form.',
    })
  }

  // The real path — the same function every reminder, alert and broadcast uses.
  const result = await deliverSMS(phone, `${BRAND.shortName}: test message. If you received this, SMS is working.`)

  return NextResponse.json({
    success: result.ok,
    sender: BRAND.smsSender,
    recipient,
    providerMessageId: result.providerMessageId ?? null,
    // Whether a retry could help. A permanent failure needs somebody to change
    // something; a transient one is worth pressing again.
    permanent: result.ok ? false : result.permanent,
    arkeselResponse: result.response ?? null,
    error: result.ok ? null : result.error,
    hint: result.ok ? 'SMS sent successfully.' : interpretArkesel(result.error, result.response),
  })
}

/** Turn a provider rejection into the thing the operator has to go and do. */
function interpretArkesel(error?: string, response?: unknown): string {
  const text = `${error || ''} ${JSON.stringify(response ?? {})}`.toLowerCase()

  if (text.includes('arkesel_api_key') || text.includes('not configured')) {
    return 'ARKESEL_API_KEY is not set on this deployment. Add it in the hosting environment, then redeploy.'
  }
  if (text.includes('insufficient') || text.includes('balance')) {
    return 'The Arkesel account has no SMS balance left. Top up at arkesel.com.'
  }
  if (text.includes('sender')) {
    return `The sender id "${BRAND.smsSender}" is not approved. Register it under Sender IDs in the Arkesel dashboard — `
      + 'until it is approved the networks drop the messages without reporting anything.'
  }
  if (text.includes('api') && text.includes('key')) {
    return 'Arkesel rejected the API key. It is wrong, expired, or from a different account.'
  }
  if (text.includes('not a valid ghanaian mobile')) {
    return 'That number was rejected before sending. Use the 0XXXXXXXXX or 233XXXXXXXXX form.'
  }
  return 'Arkesel did not accept the message. The full response is above.'
}
