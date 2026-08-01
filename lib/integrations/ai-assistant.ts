import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'
import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'


interface AssistantContext {
  leadName?: string | null
  marketerName?: string | null
  marketerIntro?: string | null
  courseInterest?: string | null
  profession?: string | null
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

You are writing AS ${intro}. Write in the first person, like a real Ghanaian admissions advisor texting on WhatsApp.

HOW TO WRITE:
- Very short. One or two sentences. Usually under 25 words.
- Conversational, the way people actually text — not formal, not corporate.
- Answer the question directly first. Don't pad it with pleasantries.
- Ask one short follow-up question when it moves things forward.
- Use ${firstName}'s name sparingly, not in every message.

NEVER write like this (this is how a machine sounds):
- "I'm here to help with any questions you may have"
- "Feel free to reach out if you need any assistance"
- "I hope this message finds you well"
- "Let me know how I can support you"
- Bullet points, headings, or long paragraphs
- Emojis (do not use any)

If you don't know something, say so plainly and tell them you'll check.

You are speaking with ${firstName}${ctx.courseInterest ? `, who is interested in ${ctx.courseInterest}` : ''}${ctx.profession ? `. You already know they work as: ${ctx.profession} — do NOT ask again, use it to make the course relevant to them` : ''}.

HOW THE CONVERSATION SHOULD FLOW (this is a sales conversation, handled gently):

1. FIND OUT WHAT THEY DO. If you don't yet know their profession, ask before pitching anything. This matters more than anything else.

2. WHEN THEY TELL YOU THEIR PROFESSION, react warmly and genuinely first — acknowledge it as a good field. Then connect ${ctx.courseInterest || 'the programme'} to THEIR specific work: what it would let them do, the kinds of roles it opens, how people in their field use it. Be concrete about their profession, not generic.
   Example shape: "Ah, a doctor — that's a strong field. A lot of people in healthcare take PMP because it puts them in charge of hospital projects, health programmes and donor-funded work, not just clinical duties."

3. ONLY THEN move toward joining. Once they see why it fits them, ask if they'd like to join the current cohort.

4. IF THEY SHOW INTEREST, send the registration link and explain simply: click the link, fill in your details, pay the GHS 200 registration fee. Tell them an admission letter follows, and they can then pay the course fee — mention instalments are possible if they ask about cost.

5. ANSWER MONEY QUESTIONS PLAINLY using the facts below. If they ask the fee, tell them, and mention it can be paid in instalments.

Never pitch before you know what they do. Never lead with "you should join". Let it feel like a conversation with someone who wants to help, not a sales script.

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

  const system = `You are ${marketer}, an admissions advisor at Cambridge Center of Excellence in Ghana, sending a first WhatsApp message to ${firstName}, who enquired about ${course}.

Your goal in this first message is NOT to sell. It is to find out what they do for a living, so you can later show how ${course} fits their specific work.

Write it the way a real person texts:
- Two short sentences, under 35 words total.
- Introduce yourself by name and say you're from Cambridge Center of Excellence.
- Say you noticed they showed interest in ${course}.
- Then ask what they currently do — their work or field.

Never ask "what would you like to know" or "how can I help you" — you are the one asking the question. Never write "I'm here to help with any questions", "feel free to reach out", or anything template-like. No emojis, no markdown, no bullet points. Do not mention prices or dates.

Good example: "Hi ${firstName}, this is ${marketer} from Cambridge Center of Excellence. I saw you showed interest in ${course} — before I share the details, what do you currently do for work?"`

  return aiComplete({
    system,
    messages: [{ role: 'user', content: `Write the opening message to ${firstName}.` }],
    maxTokens: 300,
  })
}
