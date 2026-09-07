import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { queueSMS } from '@/lib/notifications/sms'
import { CONFIG } from '@/lib/config'

export const runtime = 'nodejs'

/**
 * Tell marketers about the leads they have been given.
 *
 * One consolidated SMS per person rather than one per lead: a distribution of
 * twenty leads is one text. Hit by the cron every few minutes, and only for
 * people whose last lead settled 3+ minutes ago so a batch groups together.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * The count was cleared whether or not the message was sent:
 *
 *     try { const ok = await sendSMS(...); if (ok) sent++ } catch {}
 *     // Reset regardless (avoid a stuck loop re-texting)
 *     await sb.from('lead_assign_pending').update({ pending: 0 })...
 *
 * So a provider outage, an exhausted SMS balance or a momentary network
 * failure discarded the fact that the person was owed a notification. There
 * was no retry, because the counter that would have driven one had been set
 * to zero — and the bare `catch {}` meant nothing was logged either. The
 * leads were assigned and visible in the portal; nobody was told to look.
 * "I never got a message about my leads" is the exact shape of that.
 *
 * The comment was not wrong about the danger — a send that fails forever
 * would re-text on every run. But zero and infinity are not the only options.
 *
 * ── WHAT IT DOES NOW ───────────────────────────────────────────────────────
 *
 * Sends through queueSMS, the same path the manual-assignment route uses, so
 * the message is written to sms_logs, retried on a transient failure and
 * deduped on a key. Three things follow:
 *
 *   - The counter is cleared only once the message is genuinely queued. A
 *     failure leaves it standing and the next run tries again.
 *   - A number that can never work (missing, or not a Ghanaian mobile) is
 *     cleared and logged rather than retried forever.
 *   - The dedupe key covers the marketer and the count, so a retry after a
 *     partial failure cannot text the same person about the same batch twice.
 */

/** Give up on one batch after this many attempts and log it loudly. */
const MAX_RUNS = 6

/**
 * Clear a marketer's pending count, and say whether it actually cleared.
 *
 * ── WHY THIS IS TWO STATEMENTS ─────────────────────────────────────────────
 *
 * The old code cleared the counter and stamped last_sms_at together. There is
 * no last_sms_at column — migration 0017 adds it — so PostgREST rejected the
 * whole statement and `pending` was not cleared either. Nobody noticed,
 * because the result was never read.
 *
 * The counter is what decides whether someone gets texted again, so clearing
 * it must not depend on a column that may not be there yet. It goes first, on
 * its own, using only marketer_id and pending. The diagnostics follow in a
 * second statement whose failure is logged and otherwise harmless — which
 * makes this endpoint correct both before and after 0017 is applied.
 *
 * And the result IS read. A clear that fails now says so.
 */
async function clearPending(
  sb: ReturnType<typeof createServiceClient>,
  marketerId: string,
  diagnostics: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await sb.from('lead_assign_pending')
    .update({ pending: 0 })
    .eq('marketer_id', marketerId)

  if (error) {
    console.error('[lead_notify] could not clear pending for', marketerId, error.message)
    return false
  }

  // Best effort: these columns arrive with migration 0017. Before it is
  // applied this fails and the notification is still correct.
  const { error: diagErr } = await sb.from('lead_assign_pending')
    .update(diagnostics)
    .eq('marketer_id', marketerId)
  if (diagErr) {
    console.warn('[lead_notify] diagnostics not recorded (apply migration 0017):', diagErr.message)
  }

  return true
}

export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()
  const settleCutoff = new Date(Date.now() - 3 * 60000).toISOString()  // last lead 3+ min ago

  /*
   * `attempts` arrives with migration 0017. Naming a column that does not
   * exist fails the whole select, so this asks for it and falls back — the
   * endpoint has to work on an instance where the migration has not been
   * applied yet, which is every instance the moment this deploys.
   */
  type Pending = { marketer_id: string; pending: number; last_lead_at: string; attempts?: number }

  const due = (cols: string) => sb.from('lead_assign_pending')
    .select(cols)
    .gt('pending', 0)
    .lte('last_lead_at', settleCutoff)
    .limit(200)
    .overrideTypes<Pending[]>()

  const first = await due('marketer_id, pending, last_lead_at, attempts')
  let pendings = first.data
  const readErr = first.error

  if (readErr) {
    console.warn('[lead_notify] reading without attempts (apply migration 0017):', readErr.message)
    ;({ data: pendings } = await due('marketer_id, pending, last_lead_at'))
  }

  if (!pendings?.length) return NextResponse.json({ ran: true, sent: 0, held: 0 })

  const portal = CONFIG.appUrl
  let sent = 0
  let held = 0
  let dropped = 0

  for (const p of pendings) {
    const { data: profile } = await sb.from('profiles')
      .select('full_name, phone').eq('id', p.marketer_id).maybeSingle()

    /*
     * No number to reach them on. Clearing is right — retrying cannot help —
     * but it is recorded, because a marketer receiving leads with no phone on
     * their profile is something an administrator needs to fix rather than a
     * fact the system should quietly absorb.
     */
    if (!profile?.phone) {
      console.error('[lead_notify] no phone on profile', p.marketer_id, `— ${p.pending} lead(s) unannounced`)
      await clearPending(sb, p.marketer_id, { attempts: 0, last_error: 'No phone number on the profile' })
      dropped++
      continue
    }

    const n = p.pending
    const first = (profile.full_name || 'there').split(' ')[0]
    const msg = n === 1
      ? `Hi ${first}, you've been assigned a new lead. Check your portal: ${portal}/marketer/leads`
      : `Hi ${first}, you've been assigned ${n} new leads. Check your portal: ${portal}/marketer/leads`

    const result = await queueSMS({
      to: profile.phone,
      message: msg,
      kind: 'lead_assigned',
      entityId: p.marketer_id,
      // The count is part of the key: the same person being told about three
      // leads and later about five are different messages, but a retry of the
      // same batch is not.
      dedupeKey: `lead_pending:${p.marketer_id}:${n}:${String(p.last_lead_at).slice(0, 16)}`,
    })

    // Queued (or already queued by an earlier run) means the notification is
    // owned by the SMS queue, which retries on its own. Only then is the
    // counter safe to clear.
    if (result.queued || result.duplicate) {
      await clearPending(sb, p.marketer_id, {
        attempts: 0, last_error: null, last_sms_at: new Date().toISOString(),
      })
      if (result.sent) sent++
      continue
    }

    /*
     * Could not even be queued. The count stands so the next run tries again
     * — up to a point: a batch that has failed MAX_RUNS times is cleared and
     * logged, so one broken row cannot make this endpoint fail forever.
     */
    const attempts = (p.attempts || 0) + 1
    if (attempts >= MAX_RUNS) {
      console.error('[lead_notify] giving up after', attempts, 'runs for', p.marketer_id, `— ${n} lead(s) unannounced`)
      await clearPending(sb, p.marketer_id, { attempts: 0, last_error: `Gave up after ${attempts} attempts` })
      dropped++
    } else {
      // The count deliberately stands, so the next run tries again.
      const { error } = await sb.from('lead_assign_pending')
        .update({ attempts, last_error: 'Could not be queued' })
        .eq('marketer_id', p.marketer_id)
      if (error) console.warn('[lead_notify] attempt counter not recorded (apply migration 0017):', error.message)
      held++
    }
  }

  return NextResponse.json({ ran: true, sent, held, dropped })
}
