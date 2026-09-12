import 'server-only'
import { SECRETS } from '@/lib/config.server'
import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'
import { loadKnowledge } from '@/lib/chatbot/knowledge'
import { allowedAmounts, unsupportedAmounts } from '@/lib/chatbot/moneyGuard'
import { hasFacts } from '@/lib/chatbot/format'
import { buildSystemPrompt, buildOpeningPrompt, selfDescription } from '@/lib/chatbot/persona'
import { classify, scoreIntent, ESCALATING, type Intent, type IntentScore } from '@/lib/chatbot/intent'
import { nextStage, type Stage } from '@/lib/chatbot/stage'
import { actionsFor, renderActions, matchAction, type Action, type ActionId } from '@/lib/chatbot/actions'
import { forWhatsApp, promisedFollowUp, type HandoffReason } from '@/lib/chatbot/rules'
import type { LeadContext } from '@/lib/chatbot/context'

/**
 * The Cambridge sales and admissions assistant.
 *
 * A lead-conversion engine with a conversational interface, not a model that
 * answers WhatsApp messages. The division of responsibility is the design:
 *
 *   THE APPLICATION owns truth. Programme facts, fees, dates, brochure
 *   availability, whether registration is possible, who the colleague is,
 *   when a person must be reached, what state the conversation is in, and
 *   what happens when any of it fails.
 *
 *   THE MODEL owns language. Wording, tone, nuance, and reading what somebody
 *   meant. Nothing else.
 *
 * Reversing those is how a chatbot invents a fee.
 */

export { handOffToHuman } from '@/lib/chatbot/handoff'
export { needsHumanOutright, forWhatsApp, promisedFollowUp } from '@/lib/chatbot/rules'
export { classify, classifyAll, scoreIntent } from '@/lib/chatbot/intent'
export { buildLeadContext, LEAD_COLUMNS } from '@/lib/chatbot/context'
export { recordEvent, loadState } from '@/lib/chatbot/events'
export { actionsFor, renderActions, matchAction } from '@/lib/chatbot/actions'
export { selfDescription } from '@/lib/chatbot/persona'
export type { HandoffReason } from '@/lib/chatbot/rules'
export type { LeadContext } from '@/lib/chatbot/context'
export type { Stage } from '@/lib/chatbot/stage'
export type { Intent, IntentScore } from '@/lib/chatbot/intent'
export type { Action, ActionId } from '@/lib/chatbot/actions'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export type ChatbotReply = {
  /** What to send. Null when the assistant should stay silent. */
  text: string | null
  /** Sent on its own, after the text. A brochure or a registration link. */
  attachment: { kind: 'brochure' | 'registration'; url: string } | null
  /** Set when this conversation must now go to a person, and why. */
  handoff: HandoffReason | null
  /** Where the conversation has got to, after this message. */
  stage: Stage
  /** What the lead was asking for. */
  intent: Intent
  /** How close they are to registering. Internal — never quoted to the lead. */
  score: IntentScore
  /** Offered with the reply, so the caller can record what was on the table. */
  actions: Action[]
  /**
   * Why the model's reply was not the thing sent.
   *
   * `unsupported-amount` is not a failure of the model being absent — it is a
   * reply that arrived, was read, and was refused because it quoted a price
   * the centre has no record of.
   */
  skipped?: 'disabled' | 'no-model' | 'model-failed' | 'unsupported-amount'
}

/** Escalating intents, mapped to the reason recorded against the handover. */
const HANDOFF_FOR: Partial<Record<Intent, HandoffReason>> = {
  human: 'asked_for_person',
  payment: 'own_record',
  complaint: 'complaint',
}

/**
 * Answer one incoming message.
 *
 * Does NOT perform the handover or record events — the caller does both,
 * because only the caller knows whether the message was actually delivered.
 * A handover raised for a reply that never arrived would pause the assistant
 * on a conversation where nobody had been told anything.
 */
export async function chatbotReply(opts: {
  message: string
  ctx: LeadContext
  history?: ChatTurn[]
  /** What was offered last time, so a reply of "2" can be understood. */
  offered?: Action[]
}): Promise<ChatbotReply> {
  const { message, ctx, history = [], offered = [] } = opts
  const stage0 = ctx.state.stage

  /*
   * A reply to the numbered options is turned into the thing it meant, before
   * anything else looks at it. "2" carries no intent of its own; "Fees" does.
   */
  const chosen = matchAction(message, offered)
  const effective = chosen ? actionAsMessage(chosen.id) : message

  const intent = classify(effective)
  const score = scoreIntent(effective, history.map(h => h.content))

  const base = {
    intent, score,
    stage: nextStage(stage0, { intent, hasProgramme: Boolean(ctx.programme), hasProfession: Boolean(ctx.profession) }),
  }

  if (!SECRETS.aiAssistantEnabled) {
    return { ...base, text: null, attachment: null, handoff: null, actions: [], skipped: 'disabled' }
  }

  /*
   * ── ESCALATION HAPPENS BEFORE THE MODEL ──────────────────────────────────
   *
   * Somebody asking for a person, asking where their payment went, or making
   * a complaint reaches a person whether or not the model is available, in
   * credit, or right that day — and without the model being given a chance to
   * reassure them out of it. Section 16 of the brief.
   */
  if (ESCALATING.has(intent)) {
    return {
      ...base,
      text: escalationMessage(intent, ctx),
      attachment: null,
      handoff: HANDOFF_FOR[intent]!,
      actions: [],
    }
  }

  if (!aiConfigured()) {
    return { ...base, text: fallbackMessage(ctx), attachment: null, handoff: 'assistant_unsure', actions: [], skipped: 'no-model' }
  }

  /*
   * A brochure is a file, not a sentence. The application decides whether one
   * exists; the model never claims it does.
   */
  if (intent === 'brochure') {
    if (ctx.programme && ctx.capability.canSendBrochure && ctx.programme.brochureUrl) {
      const actions = actionsFor({
        capability: ctx.capability, stage: base.stage,
        taken: [...ctx.state.taken, 'brochure'], humanName: ctx.marketerName,
      })
      return {
        ...base,
        text: `Sending you the ${ctx.programme.name} brochure now.` + renderActions(actions),
        attachment: { kind: 'brochure', url: ctx.programme.brochureUrl },
        handoff: null,
        actions,
      }
    }
    /*
     * Asked for something that does not exist. It is never offered, so this is
     * somebody asking unprompted — and it goes to a person rather than
     * becoming an apology that leads nowhere.
     */
    return {
      ...base,
      text: `I don't have a brochure on file for that one. ${byName(ctx, 'will send you the details directly')}.`,
      attachment: null,
      handoff: 'assistant_unsure',
      actions: [],
    }
  }

  /*
   * ── A FAILED READ IS NOT AN EMPTY CENTRE ─────────────────────────────────
   *
   * If the programme records could not be READ, the assistant knows nothing
   * and must not behave as though the centre simply has no programmes — that
   * state it handles by asking which one they mean, which would be a
   * conversation conducted entirely in the dark.
   */
  if (ctx.programmesUnavailable) {
    console.error('[chatbot] programme records unreadable — handing to a person')
    return { ...base, text: fallbackMessage(ctx), attachment: null, handoff: 'no_knowledge', actions: [] }
  }

  const loadedKnowledge = await loadKnowledge()
  if (!loadedKnowledge.ok) {
    console.error('[chatbot] knowledge unreadable — handing to a person:', loadedKnowledge.error)
    return { ...base, text: fallbackMessage(ctx), attachment: null, handoff: 'no_knowledge', actions: [] }
  }
  const knowledge = loadedKnowledge.data

  /*
   * With nothing to answer from, the assistant does not answer. The prompt
   * says so too, but a prompt is a request and this is a rule: a model with
   * no facts and a question about fees will produce a number.
   */
  if (!hasFacts(knowledge) && !ctx.programme) {
    console.error('[chatbot] no programme and no knowledge — handing to a person')
    return { ...base, text: fallbackMessage(ctx), attachment: null, handoff: 'no_knowledge', actions: [] }
  }

  const raw = await aiComplete({
    system: buildSystemPrompt({ ctx, knowledge, stage: base.stage }),
    messages: [...history.slice(-8), { role: 'user', content: effective }],
    maxTokens: 400,
  })

  if (!raw) {
    /*
     * The model failed. Section 27: do not leave the lead unanswered. They get
     * a straight answer and a person, rather than silence.
     */
    console.error('[chatbot] model returned nothing — falling back to a person')
    return { ...base, text: fallbackMessage(ctx), attachment: null, handoff: 'assistant_unsure', actions: [], skipped: 'model-failed' }
  }

  const text = forWhatsApp(raw)

  /*
   * ── WHAT IT SAID, AGAINST WHAT IS ON FILE ────────────────────────────────
   *
   * Every guard above this point asks whether the assistant HAS the facts.
   * None asked whether the sentence it produced matches them. The prompt
   * requests that, and a prompt is a request: a model holding "PMP, GHS
   * 3,950" will sometimes write 4,000 — rounding, merging two programmes, or
   * simply completing the shape of the question.
   *
   * A wrong fee is the most expensive sentence this product can send. It goes
   * to a stranger, in a marketer's name, and the centre is then left either
   * honouring a price it never set or telling somebody it has gone up since
   * they decided to enrol.
   *
   * So the reply is not sent. Handing to a person is the same answer this
   * file gives every other time it cannot stand behind what it would say, and
   * it is recoverable in a way that a quoted number is not.
   */
  const known = allowedAmounts(
    ctx.programme ? [ctx.programme, ...ctx.allProgrammes] : ctx.allProgrammes,
    knowledge.text,
  )
  const invented = unsupportedAmounts(text, known)
  if (invented.length) {
    console.error(
      '[chatbot] reply quoted an amount that is not on file:', invented.join(', '),
      '— handing to a person instead of sending it',
    )
    return {
      ...base,
      text: fallbackMessage(ctx),
      attachment: null,
      handoff: 'assistant_unsure',
      actions: [],
      skipped: 'unsupported-amount',
    }
  }

  const actions = actionsFor({
    capability: ctx.capability,
    stage: base.stage,
    taken: ctx.state.taken,
    humanName: ctx.marketerName,
  })

  /*
   * Registration is an intent, never a completion. The link goes separately;
   * being registered means having filled it in and paid, which this assistant
   * cannot see and must not claim.
   */
  const attachment = intent === 'register' && ctx.capability.canRegister && ctx.registrationLink
    ? { kind: 'registration' as const, url: ctx.registrationLink }
    : null

  return {
    ...base,
    text: text + renderActions(actions),
    attachment,
    // A promise to check is a promise somebody has to keep.
    handoff: promisedFollowUp(text) ? 'assistant_unsure' : null,
    actions,
  }
}

/** What choosing a numbered option means, in words the classifier understands. */
function actionAsMessage(id: ActionId): string {
  switch (id) {
    case 'view_programme': return 'Tell me about the programme'
    case 'view_fees': return 'How much is it?'
    case 'view_schedule': return 'When does it start?'
    case 'brochure': return 'Please send me the brochure'
    case 'register': return 'I want to register'
    case 'speak_to_human': return 'I would like to speak to someone'
    default: return 'I have a question'
  }
}

/** "Ruth will…" where a colleague is known, "someone will…" where not. */
function byName(ctx: LeadContext, verb: string): string {
  const first = ctx.marketerName?.split(' ')[0]
  return first ? `${first} ${verb}` : `Someone from the team ${verb}`
}

function escalationMessage(intent: Intent, ctx: LeadContext): string {
  switch (intent) {
    case 'payment':
      return `That one I can't check from here. ${byName(ctx, 'will look it up and come back to you')}.`
    case 'complaint':
      return `I'm sorry about that. ${byName(ctx, 'is picking this up personally')}.`
    default:
      return `Of course. ${byName(ctx, 'will take it from here')}.`
  }
}

/** Said when the assistant cannot help, whatever the cause. Never silence. */
function fallbackMessage(ctx: LeadContext): string {
  return `Thanks for your message. I can't get to that detail right now, so ${byName(ctx, 'is picking it up for you')}.`
}

/**
 * The first message to a newly assigned lead.
 *
 * Introduces the centre and the colleague handling the enquiry, names the
 * programme they asked about, and asks the one question that makes every
 * later answer useful.
 */
export async function chatbotOpening(ctx: LeadContext): Promise<{ text: string; actions: Action[] } | null> {
  if (!SECRETS.aiAssistantEnabled || !aiConfigured()) return null

  const raw = await aiComplete({
    system: buildOpeningPrompt(ctx),
    messages: [{ role: 'user', content: 'Write the opening message.' }],
    maxTokens: 300,
  })
  if (!raw) return null

  const actions = actionsFor({
    capability: ctx.capability,
    stage: 'DISCOVERY',
    humanName: ctx.marketerName,
  })

  return { text: forWhatsApp(raw) + renderActions(actions), actions }
}

void selfDescription
