import { createServiceClient } from '@/lib/supabase/server'

/**
 * Decide when the assistant may speak again after a human took over.
 *
 * A marketer never tells us "I'm done", so we infer it: if they have not
 * replied for a while AND the lead is now waiting on an answer, the handover
 * has gone quiet and the assistant resumes so the lead is not left hanging.
 * A marketer can also resume it by hand at any time from the lead page.
 */
const QUIET_HOURS = 6

export async function maybeResumeAI(leadId: string): Promise<boolean> {
  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads')
    .select('id, ai_paused, ai_paused_by, last_human_at, updated_at, needs_human').eq('id', leadId).maybeSingle()
  if (!lead?.ai_paused) return true            // already active

  /*
   * ── THIS NET HAS NEVER FIRED ─────────────────────────────────────────────
   *
   * It tested for 'human'. Nothing has ever written 'human': the webhook
   * writes 'manual' when a marketer takes over, and that was the only
   * non-null value in the system. So every paused lead failed this line and
   * returned false, and the safety net described at the top of this file —
   * "the assistant resumes so the lead is not left hanging" — has been dead
   * code since it was written. A lead whose marketer went quiet stayed
   * unanswered until somebody noticed and pressed Resume AI.
   *
   * Both real causes are handled now, and they are named for what they are:
   *
   *   'manual'    a person took the conversation over
   *   'assistant' the assistant handed it to a person (lib/chatbot/handoff)
   *
   * Both resume after the same quiet period, for the same reason: a lead
   * waiting with nobody answering is worse than an assistant that speaks
   * again. If the assistant still cannot help, it hands over again and the
   * colleague is notified again — which is the outcome wanted anyway.
   */
  const cause = lead.ai_paused_by
  if (cause !== 'manual' && cause !== 'assistant' && cause !== 'human') return false

  /*
   * An assistant handover has no last_human_at to measure from — no human has
   * spoken yet, which is the whole point of it. Falling through to Infinity
   * would resume it on the very next message and undo the handover, so it is
   * measured from `updated_at`, which the handover itself sets.
   *
   * `updated_at` and not a new ai_paused_at column, deliberately: this table
   * predates supabase/migrations, so there is no schema here to check a new
   * column against — and naming one that does not exist fails the whole
   * select. That is how lead_assign_pending.last_sms_at silenced every
   * assignment notification. Any later edit to the lead pushes the timestamp
   * forward, which delays the resume rather than bringing it early, so the
   * error is on the side of leaving the conversation with the person.
   */
  const from = lead.last_human_at || (cause === 'assistant' ? lead.updated_at : null)
  const since = from ? Date.now() - new Date(from).getTime() : Infinity
  if (since < QUIET_HOURS * 3600000) return false

  await sb.from('leads').update({
    ai_paused: false, needs_human: false, ai_paused_by: null,
  }).eq('id', leadId).then(() => {}, () => {})
  return true
}
