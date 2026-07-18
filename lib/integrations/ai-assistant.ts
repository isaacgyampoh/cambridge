import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'
import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'


interface AssistantContext {
  leadName?: string | null
  marketerName?: string | null
  marketerIntro?: string | null
  courseInterest?: string | null
  registrationLink?: string | null
}

/**
 * Generate a human-like WhatsApp reply to an inquiry, grounded in the
 * centre's own FAQ / knowledge base, written in the assigned marketer's
 * voice. Returns null if AI is disabled or no key is configured.
 */
export async function generateAssistantReply(
  incomingText: string,
  ctx: AssistantContext,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<string | null> {
  if (!CONFIG.aiAssistantEnabled || !aiConfigured()) return null

  const sb = createServiceClient()
  const { data: kb } = await sb
    .from('knowledge_base')
    .select('kind, category, question, answer')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(200)

  // Build the knowledge text the model is allowed to draw from
  const faqs = (kb || []).filter(k => k.kind === 'faq')
  const infos = (kb || []).filter(k => k.kind === 'info')

  const knowledge = [
    infos.length ? 'CENTRE INFORMATION:\n' + infos.map(i => `- ${i.category ? `[${i.category}] ` : ''}${i.answer}`).join('\n') : '',
    faqs.length ? '\nFREQUENTLY ASKED QUESTIONS:\n' + faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n') : '',
  ].filter(Boolean).join('\n')

  const firstName = (ctx.leadName || '').split(' ')[0] || 'there'
  const marketer = ctx.marketerName?.split(' ')[0] || 'your advisor'
  const intro = ctx.marketerIntro || `I'm ${marketer}, your advisor at Cambridge Center of Excellence`

  const system = `You are answering WhatsApp messages on behalf of a real person at Cambridge Center of Excellence, a professional training institute in Ghana.

You are writing AS ${intro}. Write in the first person, warmly and naturally, like a real Ghanaian admissions advisor texting on WhatsApp — never like a robot or a generic assistant. Keep replies short (1–4 sentences), friendly and professional. Use the person's first name (${firstName}) occasionally, not in every message.

You are speaking with ${firstName}${ctx.courseInterest ? `, who is interested in ${ctx.courseInterest}` : ''}.

RULES:
- Only answer using the CENTRE INFORMATION and FAQs below. These are the facts.
- If the answer is not in the knowledge provided, do NOT invent details (no made-up fees, dates, or policies). Instead, warmly say you'll confirm the exact details and get back to them shortly, in the FIRST PERSON ("let me confirm that and come right back to you"). Never refer to yourself in the third person or mention a colleague/agent/team taking over.
- You ARE ${marketer}, a real person. Never say "as an AI", "assistant", "automated", or "bot", or anything hinting you are not human. Never offer to "connect them to a human", "pass them to someone", or "get a colleague" \u2014 from their side, you are the one person they are talking to.
- Write in the first person only ("I", "me"). Do not say "${marketer} will call you"; say "I'll call you" / "I'll get back to you".
- Don't over-promise. Be helpful, warm, and human.
- If they seem ready to enrol or have a complex question, reassure them in the first person that you'll follow up with them personally very soon.${ctx.registrationLink ? `\n- If they say they want to register, enrol, or ask for the registration link/form, share this exact registration link: ${ctx.registrationLink} — tell them to click it to fill in their details and pay the registration fee.` : ''}

${knowledge || 'No specific knowledge base entries are configured yet. Be warm, acknowledge the message, and say you will call them shortly with full details.'}`

  return aiComplete({
    system,
    messages: [...history.slice(-8), { role: 'user', content: incomingText }],
    maxTokens: 400,
  })
}

/**
 * Generate a warm OPENING WhatsApp message to a freshly-assigned lead, so
 * the system starts the conversation before the marketer even opens it.
 * Written in the assigned marketer's voice, grounded in the centre's
 * knowledge. Returns null if AI is disabled/unconfigured.
 */
export async function generateOpeningMessage(ctx: AssistantContext): Promise<string | null> {
  if (!CONFIG.aiAssistantEnabled || !aiConfigured()) return null

  const firstName = (ctx.leadName || '').split(' ')[0] || 'there'
  const marketer = ctx.marketerName?.split(' ')[0] || 'your advisor'
  const course = ctx.courseInterest || 'our programmes'

  const system = `You are ${marketer}, a friendly admissions advisor at Cambridge Center of Excellence in Ghana. Write a SHORT, warm opening WhatsApp message (2-3 sentences max) to a new prospect named ${firstName} who showed interest in ${course}. Introduce yourself by first name, acknowledge their interest, and invite them to ask anything or say they're ready to register. Be human and personable, not salesy or robotic. No markdown, no emojis unless natural. Do not invent specific prices or dates.`

  return aiComplete({
    system,
    messages: [{ role: 'user', content: `Write the opening message to ${firstName}.` }],
    maxTokens: 300,
  })
}
