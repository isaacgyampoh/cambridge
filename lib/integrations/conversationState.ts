import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'

export interface ConversationRead {
  profession?: string | null
  status?: string | null        // interested | follow_up | not_interested | contacted
  followUpAt?: string | null    // ISO date they asked to be contacted
  summary?: string | null
}

/**
 * After each exchange, read the conversation and decide what changed: what the
 * person does, how warm they are, and whether they asked to be contacted
 * later. This is what lets the AI move a lead to "follow up" and set the date
 * itself instead of a marketer doing it by hand.
 */
export async function readConversation(
  history: { role: 'user' | 'assistant'; content: string }[],
  latest: string,
): Promise<ConversationRead | null> {
  if (!aiConfigured()) return null

  const today = new Date().toISOString().slice(0, 10)
  const transcript = [...history.slice(-8), { role: 'user' as const, content: latest }]
    .map(m => `${m.role === 'user' ? 'LEAD' : 'US'}: ${m.content}`).join('\n')

  const raw = await aiComplete({
    system: `You read a WhatsApp sales conversation and extract facts. Today is ${today}.

Reply with ONLY a JSON object, no other text:
{
  "profession": "their job or field, or null if not stated",
  "status": "interested | follow_up | not_interested | contacted",
  "followUpAt": "YYYY-MM-DD if they asked to be contacted on a specific day, else null",
  "summary": "one short sentence a colleague could read to catch up"
}

Status meaning:
- "interested" — they want to join, asked to register, or asked for the link
- "follow_up" — they asked to talk later, said they'd think about it, or named a time
- "not_interested" — they clearly declined
- "contacted" — normal conversation, nothing decided yet

If they say "tomorrow" use tomorrow's date. "Next week" means 7 days from today.`,
    messages: [{ role: 'user', content: transcript }],
    maxTokens: 200,
  })

  if (!raw) return null
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      profession: parsed.profession || null,
      status: ['interested', 'follow_up', 'not_interested', 'contacted'].includes(parsed.status) ? parsed.status : null,
      followUpAt: parsed.followUpAt || null,
      summary: parsed.summary || null,
    }
  } catch { return null }
}
