import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { recordEvent } from '@/lib/chatbot/events'

/**
 * Passing a conversation to a person.
 *
 * ── WHY THIS IS NEW ────────────────────────────────────────────────────────
 *
 * The assistant this replaces was forbidden from doing it. Its prompt said:
 *
 *     Never offer to "connect them to a human", "pass them to someone", or
 *     "get a colleague" — from their side, you are the one person they are
 *     talking to.
 *
 * So a lead asking to speak to somebody was answered by the same model, in the
 * same borrowed voice, for as long as they kept asking. There was a
 * `needs_human` column and nothing set it from a conversation.
 *
 * A handover is two separate things and both have to happen:
 *
 *   1. the lead is marked, so the assistant stops replying and a person sees
 *      it needs them;
 *   2. that person is actually told.
 *
 * Doing only the first is how a queue silently fills up.
 */

export { HANDOFF_LABEL, needsHumanOutright } from '@/lib/chatbot/rules'
export type { HandoffReason } from '@/lib/chatbot/rules'

import { HANDOFF_LABEL, type HandoffReason } from '@/lib/chatbot/rules'

export type HandoffResult = {
  handed: boolean
  /** Who it went to, for the message back to the lead. */
  toName: string | null
  /** True when the lead was already waiting for a person — nobody is told twice. */
  alreadyWaiting: boolean
}

/**
 * Mark the lead, and tell the colleague who owns it.
 *
 * Never throws: a handover that fails must not also lose the reply the lead is
 * waiting for. It reports what happened instead, and logs loudly, because a
 * conversation marked for a person nobody was told about is exactly the
 * failure this exists to prevent.
 */
export async function handOffToHuman(opts: {
  leadId: string
  reason: HandoffReason
  /** The lead's last message, so the colleague can see what they walked into. */
  lastMessage?: string | null
  /** Which programme this is about, where one has been identified. */
  programme?: string | null
  /** How close they are to registering, so a queue can be ordered. */
  score?: string | null
}): Promise<HandoffResult> {
  const { leadId, reason, lastMessage, programme, score } = opts
  const sb = createServiceClient()

  try {
    const { data: lead } = await sb.from('leads')
      .select('id, full_name, needs_human, assigned_to, profiles:assigned_to(full_name)')
      .eq('id', leadId).maybeSingle()

    if (!lead) return { handed: false, toName: null, alreadyWaiting: false }

    const owner = (lead as { profiles?: { full_name?: string } | null }).profiles?.full_name || null

    // Already waiting: mark nothing, notify nobody, but still tell the lead
    // that a person is coming — from their side that is the true answer.
    if (lead.needs_human) {
      return { handed: true, toName: owner, alreadyWaiting: true }
    }

    /*
     * `ai_paused` as well as `needs_human`.
     *
     * needs_human is what a person sees on their queue. ai_paused is what
     * stops the assistant answering the next message — the webhook checks it
     * before replying. Setting only the first would put the conversation on
     * somebody's list while the assistant carried on talking over them.
     */
    const { error } = await sb.from('leads')
      .update({ needs_human: true, ai_paused: true, ai_paused_by: 'assistant' })
      .eq('id', leadId)

    if (error) {
      console.error('[chatbot] could not mark lead for handover', leadId, error.message)
      return { handed: false, toName: owner, alreadyWaiting: false }
    }

    /*
     * The handover, recorded as an event.
     *
     * This is what makes it durable: section 15 of the brief wants the reason
     * and the time persisted, and there is no column for either on `leads` —
     * that table predates supabase/migrations and migrations here are applied
     * by hand, so a new column would be dead until somebody ran the SQL.
     * lead_activities has a timestamp and a body, exists today, and is already
     * on the lead's screen. loadState reads these back, which is also how the
     * assistant knows not to hand the same conversation over twice.
     */
    await recordEvent({
      leadId,
      event: 'HANDOVER_CREATED',
      detail: [
        HANDOFF_LABEL[reason],
        programme ? `Programme: ${programme}` : null,
        score ? `Intent: ${score}` : null,
        lastMessage ? `They said: "${String(lastMessage).slice(0, 200)}"` : null,
      ].filter(Boolean).join('. '),
    })
    await recordEvent({ leadId, event: 'AI_PAUSED', detail: HANDOFF_LABEL[reason] })

    /*
     * Telling the colleague. Without this the lead is marked and nobody
     * knows — the queue fills and the person waits.
     */
    if (lead.assigned_to) {
      /*
       * Enough context to act on, not just "a lead needs attention".
       *
       * Section 19 of the brief. A marketer opening this should already know
       * who it is, which programme, why the assistant stepped back and what
       * the person actually said — so they can answer rather than start by
       * reading the whole thread.
       */
      const body = [
        `${lead.full_name || 'A lead'}${programme ? ` — ${programme}` : ''}`,
        `Why: ${HANDOFF_LABEL[reason].toLowerCase()}`,
        lastMessage ? `They said: "${String(lastMessage).slice(0, 140)}"` : null,
        score === 'READY_TO_REGISTER' ? 'They are ready to register.' : null,
      ].filter(Boolean).join('\n')

      const { error: notifyErr } = await sb.from('notifications').insert({
        user_id: lead.assigned_to,
        type: 'lead',
        title: score === 'READY_TO_REGISTER' ? 'A lead is ready to register' : 'A lead is asking for you',
        body,
        link: `/marketer/leads/${leadId}`,
      })
      if (notifyErr) {
        console.error('[chatbot] HANDOVER NOT ANNOUNCED for lead', leadId,
          '— marked for a person, nobody told:', notifyErr.message)
        await recordEvent({ leadId, event: 'MARKETER_NOT_NOTIFIED', detail: notifyErr.message })
      } else {
        await recordEvent({ leadId, event: 'MARKETER_NOTIFIED', detail: lead.full_name || null })
      }
    } else {
      console.error('[chatbot] handover with no owner — lead', leadId,
        'is marked for a person but belongs to nobody')
    }

    return { handed: true, toName: owner, alreadyWaiting: false }
  } catch (e) {
    console.error('[chatbot] handover failed for lead', leadId, e instanceof Error ? e.message : e)
    return { handed: false, toName: null, alreadyWaiting: false }
  }
}
