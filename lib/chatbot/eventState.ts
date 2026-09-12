import type { Stage } from './stage.ts'
import type { ActionId } from './actions.ts'

/**
 * The events the assistant records, and the state derived from them.
 *
 * Pure and dependency-free. Section 4 of the brief wants the conversation
 * stage stored rather than remembered by the model, and section 29 wants every
 * important action observable — and both are the same record, because the
 * stage IS the events. A conversation that has had BROCHURE_SENT is past
 * BROCHURE_REQUEST, and no separate column can disagree with that.
 *
 * Separated from the reading and writing in lib/chatbot/events so the
 * derivation can be exercised without a database.
 */

export type ChatEvent =
  | 'CHAT_STARTED'
  | 'PROGRAMME_SELECTED'
  | 'PROGRAMME_VIEWED'
  | 'BROCHURE_REQUESTED'
  | 'BROCHURE_SENT'
  | 'BROCHURE_UNAVAILABLE'
  | 'REGISTRATION_INTENT'
  | 'REGISTRATION_LINK_SENT'
  | 'HUMAN_REQUESTED'
  | 'PAYMENT_ESCALATED'
  | 'HANDOVER_CREATED'
  | 'MARKETER_NOTIFIED'
  | 'MARKETER_NOT_NOTIFIED'
  | 'AI_PAUSED'
  | 'AI_RESUMED'
  | 'AI_ERROR'

/** The marker that makes an assistant event findable among ordinary notes. */
export const EVENT_MARKER = '[assistant]'

/** What a person reads on the lead's timeline. */
export const EVENT_LABEL: Record<ChatEvent, string> = {
  CHAT_STARTED: 'Assistant opened the conversation',
  PROGRAMME_SELECTED: 'Programme identified',
  PROGRAMME_VIEWED: 'Programme details given',
  BROCHURE_REQUESTED: 'Asked for the brochure',
  BROCHURE_SENT: 'Brochure sent',
  BROCHURE_UNAVAILABLE: 'Brochure asked for, none on record',
  REGISTRATION_INTENT: 'Said they want to register',
  REGISTRATION_LINK_SENT: 'Registration link sent',
  HUMAN_REQUESTED: 'Asked to speak to someone',
  PAYMENT_ESCALATED: 'Asked about their own payment',
  HANDOVER_CREATED: 'Passed to a person',
  MARKETER_NOTIFIED: 'Colleague notified',
  MARKETER_NOT_NOTIFIED: 'Colleague could NOT be notified',
  AI_PAUSED: 'Assistant paused',
  AI_RESUMED: 'Assistant resumed',
  AI_ERROR: 'Assistant failed to answer',
}

/** Which event implies which action has already been taken. */
export const EVENT_ACTION: Partial<Record<ChatEvent, ActionId>> = {
  BROCHURE_SENT: 'brochure',
  PROGRAMME_VIEWED: 'view_programme',
  REGISTRATION_LINK_SENT: 'register',
}

export type ConversationState = {
  stage: Stage
  /** Actions already taken, so the same one is not pushed twice. */
  taken: ActionId[]
  brochureSent: boolean
  registrationIntent: boolean
  handedOver: boolean
  /** Events newest first, for a marketer catching up. */
  recent: Array<{ event: ChatEvent; at: string; detail: string }>
}

export const EMPTY_STATE: ConversationState = {
  stage: 'NEW', taken: [], brochureSent: false,
  registrationIntent: false, handedOver: false, recent: [],
}

/**
 * The furthest point the conversation has reached.
 *
 * Deepest-wins rather than most-recent-wins: somebody who said they want to
 * register and then asked one more question about the timetable has not
 * stopped wanting to register, and a marketer queue sorted by stage must not
 * demote them for asking.
 */
export function deriveStage(
  state: Pick<ConversationState, 'handedOver' | 'registrationIntent' | 'brochureSent' | 'recent'>,
): Stage {
  if (state.handedOver) return 'HANDED_OVER'
  if (state.registrationIntent) return 'REGISTRATION_INTENT'

  const seen = new Set(state.recent.map(r => r.event))
  if (seen.has('PAYMENT_ESCALATED')) return 'PAYMENT_GUIDANCE'
  if (seen.has('HUMAN_REQUESTED')) return 'HUMAN_REQUESTED'
  if (state.brochureSent || seen.has('BROCHURE_REQUESTED')) return 'BROCHURE_REQUEST'
  if (seen.has('PROGRAMME_VIEWED')) return 'PROGRAMME_DETAILS'
  if (seen.has('PROGRAMME_SELECTED')) return 'PROGRAMME_INTEREST'
  if (seen.has('CHAT_STARTED')) return 'DISCOVERY'
  return 'NEW'
}
