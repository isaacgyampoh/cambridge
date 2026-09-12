import 'server-only'
import { SECRETS } from '@/lib/config.server'
import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'
import { loadKnowledge, hasFacts } from '@/lib/chatbot/knowledge'
import { buildSystemPrompt, buildOpeningPrompt, type ChatbotContext } from '@/lib/chatbot/persona'
import { needsHumanOutright, promisedFollowUp, forWhatsApp, type HandoffReason } from '@/lib/chatbot/rules'

/**
 * The Cambridge assistant.
 *
 * Answers on WhatsApp as the centre's assistant, captures what it learns, and
 * hands over to a named colleague. It replaces an agent that wrote in the
 * assigned marketer's voice and was forbidden from admitting it was software
 * or offering a person — see lib/chatbot/persona for what changed and why.
 *
 * Three capabilities, and nothing beyond them:
 *
 *   ANSWER   from the knowledge base, the programme list and the real class
 *            schedule. Never from what the model happens to believe.
 *   CAPTURE  what they do, what they want, how warm they are — written to the
 *            lead by the caller through readConversation.
 *   HAND OFF to the colleague who owns the lead, whenever a person serves them
 *            better.
 *
 * It reads nothing private. A question about somebody's own payment or class
 * is a handover, not an answer, because this assistant cannot see their record
 * and must not appear to.
 */

export { handOffToHuman } from '@/lib/chatbot/handoff'
export { needsHumanOutright, forWhatsApp, promisedFollowUp } from '@/lib/chatbot/rules'
export type { HandoffReason } from '@/lib/chatbot/rules'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export type ChatbotReply = {
  /** What to send. Null when the assistant should stay silent. */
  text: string | null
  /** Set when this conversation should go to a person, and why. */
  handoff: HandoffReason | null
  /** Why there is no text, for the inbound log. */
  skipped?: 'disabled' | 'no-model' | 'model-failed'
}

/**
 * Answer one incoming message.
 *
 * Returns the text to send and whether the conversation should now go to a
 * person. It does NOT perform the handover — the caller does that, because
 * only the caller knows the lead id and whether the message was actually
 * delivered.
 */
export async function chatbotReply(
  incomingText: string,
  ctx: ChatbotContext,
  history: ChatTurn[] = [],
): Promise<ChatbotReply> {
  if (!SECRETS.aiAssistantEnabled) return { text: null, handoff: null, skipped: 'disabled' }
  if (!aiConfigured()) return { text: null, handoff: null, skipped: 'no-model' }

  /*
   * The deterministic handovers run FIRST, before any model call.
   *
   * Somebody asking for a human, or asking where their payment has got to,
   * must reach a person whether or not the model is available, in credit, or
   * correct that day. These are the two cases where being clever is the wrong
   * behaviour.
   */
  const outright = needsHumanOutright(incomingText)
  if (outright) {
    const who = ctx.humanName?.split(' ')[0]
    return {
      text: outright === 'own_record'
        ? `That one I can't check from here. ${who ? `I'll ask ${who} to look it up and come back to you.` : `I'll get someone to look it up and come back to you.`}`
        : `Of course. ${who ? `I'll ask ${who} to pick this up with you.` : `I'll get someone from the team to pick this up with you.`}`,
      handoff: outright,
    }
  }

  const knowledge = await loadKnowledge()

  /*
   * With nothing to answer from, the assistant does not answer.
   *
   * The prompt says so too, but a prompt is a request and this is a rule: a
   * model with no facts and a question about fees will produce a number. The
   * conversation goes to a person instead.
   */
  if (!hasFacts(knowledge)) {
    console.error('[chatbot] no knowledge available — handing the conversation to a person')
    const who = ctx.humanName?.split(' ')[0]
    return {
      text: `Let me get you the right details on that. ${who ? `I'll ask ${who} to come back to you shortly.` : `Someone from the team will come back to you shortly.`}`,
      handoff: 'no_knowledge',
    }
  }

  const reply = await aiComplete({
    system: buildSystemPrompt(ctx, knowledge),
    messages: [...history.slice(-8), { role: 'user', content: incomingText }],
    maxTokens: 400,
  })

  if (!reply) return { text: null, handoff: null, skipped: 'model-failed' }

  const text = forWhatsApp(reply)

  /*
   * If the assistant said it would check something, or that a colleague would
   * come back, that is a promise — and a promise nobody was told about is
   * worse than never making it. The same sentence that reassures the lead
   * raises the handover.
   */
  return { text, handoff: promisedFollowUp(text) ? 'assistant_unsure' : null }
}

/**
 * The first message to a newly assigned lead.
 *
 * Introduces the centre and the assistant honestly, then asks the one question
 * that makes every later answer useful: what they do for a living.
 */
export async function chatbotOpening(ctx: ChatbotContext): Promise<string | null> {
  if (!SECRETS.aiAssistantEnabled || !aiConfigured()) return null

  const reply = await aiComplete({
    system: buildOpeningPrompt(ctx),
    messages: [{ role: 'user', content: 'Write the opening message.' }],
    maxTokens: 300,
  })

  return reply ? forWhatsApp(reply) : null
}
