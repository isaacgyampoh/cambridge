import { CONFIG } from '@/lib/config'
import { createServiceClient } from '@/lib/supabase/server'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

interface AssistantContext {
  leadName?: string | null
  marketerName?: string | null
  marketerIntro?: string | null
  courseInterest?: string | null
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
  if (!CONFIG.aiAssistantEnabled || !CONFIG.anthropicApiKey) return null

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
  const intro = ctx.marketerIntro || `I'm ${marketer}, your advisor at Cambridge Centre of Excellence`

  const system = `You are answering WhatsApp messages on behalf of a real person at Cambridge Centre of Excellence, a professional training institute in Ghana.

You are writing AS ${intro}. Write in the first person, warmly and naturally, like a real Ghanaian admissions advisor texting on WhatsApp — never like a robot or a generic assistant. Keep replies short (1–4 sentences), friendly and professional. Use the person's first name (${firstName}) occasionally, not in every message.

You are speaking with ${firstName}${ctx.courseInterest ? `, who is interested in ${ctx.courseInterest}` : ''}.

RULES:
- Only answer using the CENTRE INFORMATION and FAQs below. These are the facts.
- If the answer is not in the knowledge provided, do NOT invent details (no made-up fees, dates, or policies). Instead say you'll confirm and get back to them, or that ${marketer} will call them shortly with the details.
- Never say "as an AI" or reveal you are automated. You are ${marketer}.
- Don't over-promise. Be helpful and human.
- If they seem ready to enrol or have a complex question, reassure them that you'll call them personally very soon.

${knowledge || 'No specific knowledge base entries are configured yet. Be warm, acknowledge the message, and say you will call them shortly with full details.'}`

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CONFIG.aiModel,
        max_tokens: 400,
        system,
        messages: [
          ...history.slice(-6),
          { role: 'user', content: incomingText },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      console.error('[AI] Anthropic error', res.status, await res.text())
      return null
    }
    const data = await res.json()
    const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
    return text || null
  } catch (e: any) {
    console.error('[AI] generate error', e.message)
    return null
  }
}
