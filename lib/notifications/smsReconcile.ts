import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { deliveryReportFor, undeliveredExplanation } from '@/lib/integrations/sms'

/**
 * ASKING THE NETWORK WHAT HAPPENED, RATHER THAN ASSUMING.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * A message marked `sent` had been accepted by Arkesel. That is where the
 * record stopped, and the screen called it Delivered. For one staff number
 * every message was coming back NOT_DELIVERED at the provider while the
 * portal showed an unbroken column of green badges — so the report was
 * "staff are not receiving texts" and the evidence said everything was fine.
 *
 * This asks, per message, and writes down the answer.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 *
 * It never resends anything. An undelivered message is not a failed send: the
 * send worked and the handset could not be reached, and sending it again
 * costs a credit to reach the same switched-off phone. Deciding what to do
 * about it is a person's job, and they need to be told first.
 *
 * A lookup that does not answer leaves the row exactly as it was. Recording
 * "undelivered" because the provider timed out would invent the very failure
 * this is here to find.
 */

/** Messages older than this are the provider's history, not our problem. */
const WINDOW_MS = 3 * 86_400_000

/** One invocation's budget, so a backlog cannot run into the platform limit. */
const BUDGET_MS = 25_000

export type ReconcileResult = {
  checked: number
  delivered: number
  undelivered: number
  /** Still in flight, or the provider did not answer. Left alone, asked again later. */
  inconclusive: number
}

export async function reconcileDeliveries(opts: { limit?: number; budgetMs?: number } = {}):
  Promise<ReconcileResult | { error: string }> {
  const started = Date.now()
  const budget = opts.budgetMs ?? BUDGET_MS
  const sb = createServiceClient()

  const { data: rows, error } = await sb.from('sms_logs')
    .select('id, provider_message_id, recipient, kind')
    /*
     * Only what has been accepted and not yet resolved. `delivered` and
     * `undelivered` are final, and a queued or retrying message has no
     * reference to ask about yet.
     */
    .eq('status', 'sent')
    .not('provider_message_id', 'is', null)
    .gte('created_at', new Date(Date.now() - WINDOW_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 60)

  // A failed read is not an empty queue, and must not be reported as "nothing
  // to check" — that reads as good news.
  if (error) return { error: `The delivery log could not be read: ${error.message}` }

  const out: ReconcileResult = { checked: 0, delivered: 0, undelivered: 0, inconclusive: 0 }

  for (const row of rows || []) {
    if (Date.now() - started > budget) break

    const report = await deliveryReportFor(String(row.provider_message_id))
    out.checked++

    if (report.state === 'delivered') {
      await sb.from('sms_logs')
        .update({ status: 'delivered', last_error: null })
        .eq('id', row.id).eq('status', 'sent')
      out.delivered++
      continue
    }

    if (report.state === 'undelivered') {
      await sb.from('sms_logs')
        .update({ status: 'undelivered', last_error: undeliveredExplanation(report.detail) })
        .eq('id', row.id).eq('status', 'sent')
      out.undelivered++
      continue
    }

    // 'pending' and 'unknown' both mean: we still do not know. Nothing is
    // written, and the next pass asks again while the row is in the window.
    out.inconclusive++
  }

  return out
}
