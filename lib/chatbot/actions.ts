import type { ProgrammeCapability } from './programmeRules.ts'
import type { Stage } from './stage.ts'

/**
 * The choices offered to a lead, and how they reach WhatsApp.
 *
 * ── AN ACTION IS A CAPABILITY, NOT A BUTTON ────────────────────────────────
 *
 * Section 6 of the brief: do not hard-code the same buttons for every
 * programme, and "If a brochure does not exist, do not show 'See Brochure'."
 * So actions are derived from what the record can actually support — see
 * capabilityOf() in lib/chatbot/programme — and an action that cannot be
 * fulfilled is never built, which means it can never be offered.
 *
 * ── AND WHY THEY ARE NUMBERED, NOT TAPPED ──────────────────────────────────
 *
 * The brief asks for interactive buttons "where the WhatsApp integration
 * supports" them. This one does not. lib/integrations/whatsapp sends through
 * WaSender's send-message endpoint, whose payload is { to, text } plus media
 * URL fields — there is no interactive-message support in it, and inventing a
 * payload shape for an API this repository cannot verify would produce
 * messages that silently fail to send.
 *
 * So the action MODEL is the product and the rendering is transport-specific.
 * Today they render as a numbered list, which every WhatsApp client on any
 * handset can use and which needs nothing from the provider. `renderActions`
 * is the only place that decides that: when the transport gains real buttons,
 * that function changes and nothing else does.
 */

export type ActionId =
  | 'view_programme'
  | 'view_fees'
  | 'view_schedule'
  | 'brochure'
  | 'register'
  | 'ask_question'
  | 'speak_to_human'

export type Action = {
  id: ActionId
  /** What the lead sees. Kept short — this is a phone. */
  label: string
}

const LABELS: Record<ActionId, string> = {
  view_programme: 'Programme details',
  view_fees: 'Fees',
  view_schedule: 'Dates and schedule',
  brochure: 'Send the brochure',
  register: 'Register',
  ask_question: 'Ask something else',
  speak_to_human: 'Speak to someone',
}

/**
 * What to offer next.
 *
 * Two inputs: what the programme record can support, and where the
 * conversation has got to. Somebody who has just asked the fee is not offered
 * "Fees" again; somebody already with a colleague is offered nothing at all.
 *
 * `humanName` only changes the wording of the last option — the option itself
 * is always available, because the brief makes reaching a person a
 * first-class feature rather than a fallback.
 */
export function actionsFor(opts: {
  capability: ProgrammeCapability
  stage: Stage
  /** Actions already taken, so the same one is not offered twice running. */
  taken?: ActionId[]
  humanName?: string | null
}): Action[] {
  const { capability, stage, taken = [], humanName } = opts

  // Once a person has it, the assistant stops offering anything at all.
  if (stage === 'HANDED_OVER' || stage === 'COMPLETED') return []

  const wanted: ActionId[] = []

  switch (stage) {
    case 'NEW':
    case 'DISCOVERY':
      wanted.push('view_programme', 'view_fees', 'brochure', 'register')
      break
    case 'PROGRAMME_INTEREST':
    case 'PROGRAMME_DETAILS':
      wanted.push('view_fees', 'view_schedule', 'brochure', 'register')
      break
    case 'PRICE_DISCUSSION':
      wanted.push('register', 'view_schedule', 'brochure')
      break
    case 'BROCHURE_REQUEST':
      // After the brochure, the conversation continues. It does not end.
      wanted.push('register', 'view_fees', 'ask_question')
      break
    case 'REGISTRATION_INTENT':
    case 'REGISTRATION':
      wanted.push('register', 'view_fees')
      break
    case 'PAYMENT_GUIDANCE':
    case 'HUMAN_REQUESTED':
      // These are already going to a person; nothing else to offer.
      return []
    default:
      wanted.push('view_programme', 'brochure', 'register')
  }

  const available = wanted.filter(id => {
    if (taken.includes(id)) return false
    switch (id) {
      case 'view_fees': return capability.canQuoteFee
      case 'view_schedule': return capability.canShowSchedule
      case 'brochure': return capability.canSendBrochure
      case 'register': return capability.canRegister
      /*
       * Programme details need a programme with something in it. With no fee,
       * no schedule and no brochure there is nothing to show, and offering
       * "Programme details" would open onto an empty answer.
       */
      case 'view_programme':
        return capability.canQuoteFee || capability.canShowSchedule || capability.canSendBrochure
      default: return true
    }
  })

  /*
   * Reaching a person is always on the table, and always last.
   *
   * Trimmed to three FIRST and then appended, not appended and then trimmed.
   * Appending first meant that a programme with a fee, a schedule, a brochure
   * and registration produced four options and the slice cut "Speak to Ruth"
   * off the end — removing the one option the brief makes a first-class
   * feature, and removing it exactly when the programme was most complete.
   */
  const shown: ActionId[] = [...available.slice(0, 3), 'speak_to_human']

  return shown.map(id => ({
    id,
    label: id === 'speak_to_human' && humanName
      ? `Speak to ${humanName.split(' ')[0]}`
      : LABELS[id],
  }))
}

/**
 * The actions as a message a WhatsApp user can act on.
 *
 * A numbered list, because the transport has no buttons — see the note at the
 * top of this file. Returns an empty string when there is nothing to offer, so
 * a caller can append it unconditionally.
 */
export function renderActions(actions: Action[]): string {
  if (!actions.length) return ''
  const lines = actions.map((a, i) => `${i + 1}. ${a.label}`)
  return `\n\nReply with a number:\n${lines.join('\n')}`
}

/**
 * Which action a reply chose, if any.
 *
 * Accepts the number, and the label or a distinctive word from it, because
 * people answer a numbered list with "2", "2." and "brochure" in roughly
 * equal measure.
 */
export function matchAction(reply: string, offered: Action[]): Action | null {
  const t = String(reply || '').trim().toLowerCase()
  if (!t || !offered.length) return null

  // A bare number, the commonest answer by far.
  const num = t.match(/^#?\s*([1-9])\s*[.)]?\s*$/)
  if (num) {
    const i = Number(num[1]) - 1
    return offered[i] || null
  }

  // The label, or enough of it.
  for (const a of offered) {
    const label = a.label.toLowerCase()
    if (t === label) return a
    const distinctive = label.replace(/^(send the|speak to)\s+/, '').split(/\s+/)[0]
    if (distinctive.length >= 4 && t.includes(distinctive)) return a
  }

  return null
}
