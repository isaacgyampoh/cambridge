import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { queueSMS } from '@/lib/notifications/sms'
import { normaliseRecipient } from '@/lib/integrations/sms'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Tell marketers about the leads they have been given.
 *
 * One consolidated SMS per person rather than one per lead: a distribution of
 * twenty leads is one text. Run by the cron every few minutes, and only for
 * people whose last lead settled 3+ minutes ago so a batch groups together.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * The endpoint finished each marketer with
 *
 *     .update({ pending: 0, last_sms_at: new Date().toISOString() })
 *
 * `lead_assign_pending` has three columns — marketer_id, pending,
 * last_lead_at. There is no last_sms_at and there never was: migration 0002
 * created the table and nothing has altered it since. PostgREST rejects the
 * whole statement, so `pending` was not cleared either — and the result was
 * never read, so nothing said so. The send itself sat inside a bare catch {}.
 *
 * The two branches then failed in OPPOSITE directions, which is why this was
 * so hard to see from outside:
 *
 *   - a marketer WITH a phone kept a standing pending count and was texted
 *     again on every run, indefinitely;
 *   - a marketer with NO phone took the other branch — an update with no
 *     last_sms_at, which succeeds — and was cleared silently, so the leads
 *     they had been given were never announced at all.
 *
 * ── WHY THERE IS NO NEW COLUMN ─────────────────────────────────────────────
 *
 * The obvious repair is to add last_sms_at and a retry counter. It is also
 * the wrong one: it makes this endpoint correct only AFTER a migration has
 * been applied by hand, and until then it is exactly as broken as before, on
 * the workflow that is failing right now.
 *
 * Everything needed is already here.
 *
 *   Retries and backoff belong to sms_logs, which the SMS queue already
 *   maintains — a counter on this table would be a second, worse copy of
 *   machinery that exists.
 *
 *   Deduplication belongs to the queue's unique dedupe_key, so a re-run
 *   cannot text the same person about the same batch twice. That is what
 *   makes it safe to leave a count standing.
 *
 *   The one failure that would otherwise retry for ever is a phone number
 *   that can never be delivered to. That is decidable here, before queueing,
 *   with the same normaliseRecipient the sender uses — no counter required.
 *
 * So this reads and writes only marketer_id and pending, and is correct on
 * the database as it stands today.
 */

export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const settleCutoff = new Date(Date.now() - 3 * 60000).toISOString()  // last lead 3+ min ago

  const { data: pendings, error: readErr } = await sb.from('lead_assign_pending')
    .select('marketer_id, pending, last_lead_at')
    .gt('pending', 0)
    .lte('last_lead_at', settleCutoff)
    .limit(200)

  if (readErr) {
    console.error('[lead_notify] could not read pending assignments:', readErr.message)
    return NextResponse.json({ error: 'Could not read pending assignments.' }, { status: 500 })
  }
  if (!pendings?.length) return NextResponse.json({ ran: true, sent: 0, held: 0, dropped: 0 })

  const portal = CONFIG.appUrl
  let sent = 0     // queued for delivery
  let held = 0     // left standing, to be retried on the next run
  let dropped = 0  // cannot ever be delivered; cleared and logged

  /**
   * Clear one marketer's pending count.
   *
   * Only `pending`, and the result is read. The statement this replaces also
   * set a column that does not exist, which failed the update as a unit and
   * left the count in place — the whole reason the same people were texted
   * over and over.
   */
  async function clearPending(marketerId: string): Promise<boolean> {
    const { error } = await sb.from('lead_assign_pending')
      .update({ pending: 0 })
      .eq('marketer_id', marketerId)
    if (error) {
      console.error('[lead_notify] could not clear pending for', marketerId, error.message)
      return false
    }
    return true
  }

  for (const p of pendings) {
    const { data: profile, error: profErr } = await sb.from('profiles')
      .select('full_name, phone').eq('id', p.marketer_id).maybeSingle()

    if (profErr) {
      // Transient. Leave the count standing; the next run picks it up.
      console.error('[lead_notify] could not read profile', p.marketer_id, profErr.message)
      held++
      continue
    }

    /*
     * Nothing to deliver to, and no run will change that until somebody
     * edits the profile. Clearing is right; doing it silently was not.
     * Someone receiving leads that cannot be announced is a thing an
     * administrator has to be able to find out about.
     */
    const number = profile?.phone ? normaliseRecipient(profile.phone) : null
    if (!number) {
      console.error(
        '[lead_notify] no usable phone for marketer', p.marketer_id,
        profile?.full_name ? `(${profile.full_name})` : '',
        `— ${p.pending} lead(s) assigned and unannounced`,
        profile?.phone ? '— number on file is not a Ghanaian mobile' : '— no number on file',
      )
      await clearPending(p.marketer_id)
      dropped++
      continue
    }

    const n = p.pending
    const first = (profile?.full_name || 'there').split(' ')[0]
    const msg = n === 1
      ? `Hi ${first}, you've been assigned a new lead. Check your portal: ${portal}/marketer/leads`
      : `Hi ${first}, you've been assigned ${n} new leads. Check your portal: ${portal}/marketer/leads`

    const result = await queueSMS({
      to: number,
      message: msg,
      kind: 'lead_assigned',
      entityId: p.marketer_id,
      /*
       * The count and the settling time are part of the key: being told about
       * three leads and later about five are different messages, but a retry
       * of the same batch is the same message and must not send twice.
       */
      dedupeKey: `lead_pending:${p.marketer_id}:${n}:${String(p.last_lead_at).slice(0, 16)}`,
    })

    /*
     * Queued — or already owned by an earlier run — means the SMS queue has
     * it, and the queue retries on its own. Only then is the count safe to
     * clear. Anything else leaves it standing to be tried again, which is
     * safe precisely because of the dedupe key above.
     */
    if (result.queued || result.duplicate) {
      if (await clearPending(p.marketer_id)) sent++
      else held++
    } else {
      console.error('[lead_notify] could not queue notification for', p.marketer_id, `— ${n} lead(s) still pending`)
      held++
    }
  }

  return NextResponse.json({ ran: true, sent, held, dropped })
}
