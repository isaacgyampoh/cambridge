import { NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { normaliseRecipient } from '@/lib/integrations/sms'
import { smsHealth } from '@/lib/notifications/sms'

export const runtime = 'nodejs'

/**
 * SMS delivery observability.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * The question the system could not answer was "why didn't this member of
 * staff receive their SMS?". sms_logs held the evidence — 438 delivered, 27
 * failed, 22 of those a provider timeout — but nothing surfaced it, so the
 * failures were only found by querying the database directly during an audit.
 * A delivery problem that nobody can see is indistinguishable from no problem
 * at all, which is how twenty-two staff notifications went missing unnoticed.
 *
 * Three questions, one endpoint:
 *
 *   ?          — the current state of the queue
 *   ?phone=    — every message ever addressed to one number
 *   ?status=   — the backlog, or everything that has given up
 */

const PAGE = 100

/** Statuses a caller may filter on. Anything else is refused, not ignored. */
const FILTERABLE = ['queued', 'sending', 'retrying', 'sent', 'failed'] as const

// The portal list here must match lib/access/apiAccess.ts for this path and
// lib/access/portals.ts for /admin/sms-delivery. If they drift, a user reaches
// the screen and is then refused its data — a blank page with no explanation,
// which is the failure this screen exists to remove. tests/apiAccess.test.ts
// asserts the three agree.
export const GET = withGuard({ portals: ['broadcast', 'messages', 'settings'] }, async (req) => {
  const url = new URL(req.url)
  const phone = url.searchParams.get('phone')
  const status = url.searchParams.get('status')
  const kind = url.searchParams.get('kind')
  const sb = createServiceClient()

  // The delivery record itself. `message` is included deliberately: knowing
  // WHICH message failed is most of the diagnosis. It never contains a
  // credential — provider_response is the response body, not the request, and
  // the API key travels in a header that is never logged.
  let query = sb.from('sms_logs')
    .select('id, recipient, kind, entity_id, status, attempts, max_attempts, provider_message_id, last_error, created_at, sent_at, next_retry_at, message')
    .order('created_at', { ascending: false })
    .limit(PAGE)

  if (phone) {
    // Matched on the canonical form, so 0201234567 and +233 20 123 4567 find
    // the same history rather than one of them silently returning nothing.
    const canonical = normaliseRecipient(phone)
    if (!canonical) {
      return NextResponse.json(
        { error: `"${phone}" is not a Ghanaian mobile number.` }, { status: 400 }
      )
    }
    query = query.eq('recipient', canonical)
  }

  if (status) {
    if (!FILTERABLE.includes(status as typeof FILTERABLE[number])) {
      return NextResponse.json({ error: `Unknown status "${status}".` }, { status: 400 })
    }
    query = query.eq('status', status)
  }

  if (kind) query = query.eq('kind', kind)

  const [{ data, error }, health] = await Promise.all([query, smsHealth()])

  if (error) {
    // Surfaced, not swallowed. An empty list because the query failed must not
    // look like an empty list because nothing was sent.
    console.error('[sms/delivery]', error.message)
    return NextResponse.json(
      { error: 'Could not read the delivery log.' }, { status: 500 }
    )
  }

  return NextResponse.json({
    health,
    messages: (data || []).map(row => ({ ...row, diagnosis: diagnose(row) })),
    truncated: (data?.length || 0) === PAGE,
  })
})

type Row = {
  status: string
  attempts: number
  max_attempts: number
  last_error: string | null
  next_retry_at: string | null
  provider_message_id: string | null
}

/**
 * Turn a row into the sentence an administrator actually needs.
 *
 * The raw columns are already enough for an engineer. They are not enough for
 * whoever is being asked why a colleague never got their text, which is the
 * person who has to answer for it.
 */
function diagnose(row: Row): string {
  switch (row.status) {
    case 'sent':
      return row.provider_message_id
        ? `Delivered to the network. Arkesel reference ${row.provider_message_id}.`
        : 'Delivered to the network, but no provider reference was returned.'

    case 'queued':
      return 'Waiting for the next delivery run. No attempt has been made yet.'

    case 'sending':
      return 'An attempt is in flight. If the worker fails, this is reclaimed automatically within 15 minutes.'

    case 'retrying':
      return `Attempt ${row.attempts} of ${row.max_attempts} failed (${row.last_error || 'no reason recorded'}). ` +
        `Trying again${row.next_retry_at ? ` at ${new Date(row.next_retry_at).toLocaleString('en-GB')}` : ''}.`

    case 'failed':
      if (/timeout|aborted/i.test(row.last_error || '')) {
        return `Given up after ${row.attempts} attempt(s): the provider did not respond in time. ` +
          `The message may in fact have gone out — a timeout tells us nothing either way.`
      }
      if (/no valid number/i.test(row.last_error || '')) {
        return 'The provider rejected the number outright. Correct the number on the record and send again.'
      }
      return `Given up after ${row.attempts} attempt(s): ${row.last_error || 'no reason recorded'}.`

    default:
      return `Status "${row.status}" predates the delivery queue; no attempt history was kept.`
  }
}
