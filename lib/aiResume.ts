import { createServiceClient } from '@/lib/supabase/server'

/**
 * When the assistant may speak again — and the one state model that decides.
 *
 * ── THE STATE MODEL ────────────────────────────────────────────────────────
 *
 * `leads.ai_paused` says whether the assistant is silent.
 * `leads.ai_paused_by` says who silenced it, and there are exactly two values:
 *
 *   'manual'     a colleague replied on the line and took the conversation
 *                over. Set by the WhatsApp webhook when it sees an outbound
 *                message that the system did not send.
 *
 *   'assistant'  the assistant handed the conversation over on purpose — they
 *                asked for a person, raised a payment, complained, or it had
 *                nothing to answer with. Set by lib/chatbot/handoff.
 *
 * `null` alongside ai_paused = true means a pause nobody recorded a cause for.
 * That is an orphan, from an earlier fault that misread a lead's own message
 * as staff typing, and the webhook clears it on sight.
 *
 * A third value, 'human', appeared in this file and nowhere else. Nothing has
 * ever written it, which is why the resume path below never once fired: every
 * paused lead failed the comparison and returned false. It is gone.
 *
 * ── AND WHY NOTHING RESUMES ON A TIMER ANY MORE ────────────────────────────
 *
 * This file briefly resumed a pause after six quiet hours, on the reasoning
 * that a lead waiting with nobody answering is worse than an assistant that
 * speaks again.
 *
 * That reasoning is wrong for a handover, and the brief is explicit about it:
 * once a conversation has been handed over the assistant must not resume
 * simply because another message arrives. The lead asked for a person. An
 * assistant that returns six hours later, having been told plainly that a
 * colleague was taking over, reads as the centre ignoring them — and on a
 * payment question it would go back to saying it cannot check, forever.
 *
 * So a pause ends exactly two ways:
 *
 *   1. a colleague replies on the line, which is the conversation continuing
 *      as intended and needs nothing from this file;
 *   2. somebody presses Resume AI, which is /api/admin/resume-ai.
 *
 * The safety net against a lead being forgotten is not a timer. It is the
 * notification the handover sends, the event on the lead's timeline, and the
 * marketer's own queue — where `needs_human` is what puts them at the top.
 */

/** The causes a pause may have. Anything else is an orphan. */
export const PAUSE_CAUSES = ['manual', 'assistant'] as const
export type PauseCause = typeof PAUSE_CAUSES[number]

export function isKnownCause(value: unknown): value is PauseCause {
  return typeof value === 'string' && (PAUSE_CAUSES as readonly string[]).includes(value)
}

/**
 * May the assistant answer this lead?
 *
 * Returns true when it is free to speak. It never resumes a paused
 * conversation on its own — see the note above — so the only `true` it
 * returns for a paused lead is for an orphaned pause with no recorded cause,
 * which was never a decision anybody made.
 */
export async function maybeResumeAI(leadId: string): Promise<boolean> {
  const sb = createServiceClient()
  const { data: lead, error } = await sb.from('leads')
    .select('id, ai_paused, ai_paused_by')
    .eq('id', leadId).maybeSingle()

  if (error) {
    // Unknown state. Stay silent: speaking over a colleague is the worse error.
    console.error('[aiResume] could not read the pause state for', leadId, error.message)
    return false
  }
  if (!lead?.ai_paused) return true            // already free to answer

  if (isKnownCause(lead.ai_paused_by)) return false

  /*
   * An orphaned pause. No cause was recorded, which means no person and no
   * handover put it there — it is left over from the fault that misread a
   * lead's own message as a colleague replying. Clearing it is safe, and
   * leaving it means a lead nobody is answering and nobody knows about.
   */
  const { error: clearErr } = await sb.from('leads')
    .update({ ai_paused: false, needs_human: false, ai_paused_by: null })
    .eq('id', leadId)

  if (clearErr) {
    console.error('[aiResume] could not clear an orphaned pause on', leadId, clearErr.message)
    return false
  }
  return true
}
