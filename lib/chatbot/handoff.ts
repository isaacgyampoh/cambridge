import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

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
}): Promise<HandoffResult> {
  const { leadId, reason, lastMessage } = opts
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

    await sb.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'note',
      subject: 'Passed to a person',
      description: `${HANDOFF_LABEL[reason]}.${lastMessage ? ` They said: "${String(lastMessage).slice(0, 200)}"` : ''}`,
      created_by: null,
    }).then(() => {}, () => { /* the handover itself already succeeded */ })

    /*
     * Telling the colleague. Without this the lead is marked and nobody
     * knows — the queue fills and the person waits.
     */
    if (lead.assigned_to) {
      const { error: notifyErr } = await sb.from('notifications').insert({
        user_id: lead.assigned_to,
        type: 'lead',
        title: 'A lead is asking for you',
        body: `${lead.full_name || 'A lead'} — ${HANDOFF_LABEL[reason].toLowerCase()}.`,
        link: `/marketer/leads/${leadId}`,
      })
      if (notifyErr) {
        console.error('[chatbot] HANDOVER NOT ANNOUNCED for lead', leadId,
          '— marked for a person, nobody told:', notifyErr.message)
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
