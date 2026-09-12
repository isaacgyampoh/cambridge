import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * What the assistant did, recorded where a person can see it.
 *
 * ── TWO JOBS, ONE TABLE ────────────────────────────────────────────────────
 *
 * Section 29 of the brief wants every important AI action observable, and
 * section 4 wants the conversation stage stored rather than remembered by the
 * model. Both are served by the same record, because the stage IS the events:
 * a conversation that has had BROCHURE_SENT is past BROCHURE_REQUEST, and no
 * separate column can disagree with that.
 *
 * ── WHY lead_activities AND NOT A NEW TABLE ────────────────────────────────
 *
 * There is no schema in this repository for a new one — supabase/migrations
 * covers a handful of tables and `leads`, `lead_activities` and
 * `ai_conversations` all predate it — and migrations here are applied by hand,
 * so anything depending on a new column or table would be dead until somebody
 * ran the SQL. That is the condition this system has been bitten by twice:
 * lead_assign_pending.last_sms_at silenced every assignment notification, and
 * courses.price may have been quietly returning no fees at all.
 *
 * So this writes to a table that exists, with an activity_type that is already
 * in use. `note` is one of exactly four values seen in this codebase
 * ('assignment', 'call', 'note', 'whatsapp'), and a fifth might violate a
 * constraint nobody here can read. The event name lives in `subject` behind a
 * marker, which is greppable, sortable, and shows up on the lead page as a
 * readable line rather than as a code.
 */

export {
  EVENT_MARKER, EVENT_LABEL, EVENT_ACTION, EMPTY_STATE, deriveStage,
} from '@/lib/chatbot/eventState'
export type { ChatEvent, ConversationState } from '@/lib/chatbot/eventState'

import {
  EVENT_MARKER, EVENT_LABEL, EVENT_ACTION, EMPTY_STATE, deriveStage,
  type ChatEvent, type ConversationState,
} from '@/lib/chatbot/eventState'

/**
 * Record one event.
 *
 * Never throws and never blocks the reply: an audit line that fails to write
 * must not cost the lead their answer. It does log, because an event nobody
 * recorded is the thing this module exists to prevent.
 */
export async function recordEvent(opts: {
  leadId: string
  event: ChatEvent
  detail?: string | null
}): Promise<void> {
  const { leadId, event, detail } = opts
  try {
    const sb = createServiceClient()
    const { error } = await sb.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'note',
      subject: `${EVENT_MARKER} ${event}`,
      description: `${EVENT_LABEL[event]}${detail ? `. ${String(detail).slice(0, 400)}` : ''}`,
      created_by: null,
    })
    if (error) console.error('[chatbot] event not recorded:', event, error.message)
  } catch (e) {
    console.error('[chatbot] event not recorded:', event, e instanceof Error ? e.message : e)
  }
}

/**
 * Read the conversation's state back out of its events.
 *
 * Derived rather than stored, so it cannot drift from what actually happened.
 * A failed read returns the empty state, which makes the assistant behave as
 * though the conversation were new — cautious and slightly repetitive, rather
 * than confidently wrong about what it has already done.
 */
export async function loadState(leadId: string): Promise<ConversationState> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb.from('lead_activities')
      .select('subject, description, created_at')
      .eq('lead_id', leadId)
      .like('subject', `${EVENT_MARKER}%`)
      .order('created_at', { ascending: false })
      .limit(40)

    if (error) {
      console.error('[chatbot] could not read conversation state:', error.message)
      return EMPTY_STATE
    }
    if (!data?.length) return EMPTY_STATE

    const state: ConversationState = { ...EMPTY_STATE, taken: [], recent: [] }

    for (const row of data) {
      const name = String(row.subject || '').replace(EVENT_MARKER, '').trim() as ChatEvent
      if (!(name in EVENT_LABEL)) continue

      state.recent.push({
        event: name,
        at: String(row.created_at || ''),
        detail: String(row.description || ''),
      })

      const action = EVENT_ACTION[name]
      if (action && !state.taken.includes(action)) state.taken.push(action)

      if (name === 'BROCHURE_SENT') state.brochureSent = true
      if (name === 'REGISTRATION_INTENT' || name === 'REGISTRATION_LINK_SENT') state.registrationIntent = true
      if (name === 'HANDOVER_CREATED') state.handedOver = true
    }

    state.stage = deriveStage(state)
    return state
  } catch (e) {
    console.error('[chatbot] could not read conversation state:', e instanceof Error ? e.message : e)
    return EMPTY_STATE
  }
}
