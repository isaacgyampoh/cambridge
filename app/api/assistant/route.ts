import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'

export const runtime = 'nodejs'

/**
 * Gyampoh AI — system-wide assistant for staff.
 * Answers questions, does research, and helps with writing. Grounded in the
 * Cambridge knowledge base (courses, fees, dates) so it's accurate about the
 * institution, while still able to help with general questions.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '', userId: '' }
  if (!session.valid) return NextResponse.json({ error: 'Please sign in' }, { status: 401 })

  if (!aiConfigured()) {
    return NextResponse.json({ error: 'The AI is not configured yet. Add your AI key to enable Gyampoh AI.' }, { status: 503 })
  }

  const { messages } = await req.json()
  if (!Array.isArray(messages) || !messages.length) {
    return NextResponse.json({ error: 'No message' }, { status: 400 })
  }

  const sb = createServiceClient()

  // Ground the assistant in the knowledge base (courses, fees, facts)
  let knowledge = ''
  try {
    const { data: kb } = await sb.from('knowledge_base').select('question, answer').eq('is_active', true).limit(60)
    if (kb?.length) knowledge = kb.map((k: any) => `Q: ${k.question}\nA: ${k.answer}`).join('\n\n')
  } catch {}

  // Staff member's name for a personal touch (already in the session)
  const name = (session as any).fullName?.split(' ')[0] || 'there'

  const system = `You are Gyampoh AI, the in-house assistant for Cambridge Centre of Excellence (CCE), a professional training institute in Ghana (courses include PMP, HR/PHRi/SPHRi and others).

You help the staff member (named ${name}) with:
- Questions about CCE's courses, fees, schedules and processes (use the knowledge below).
- General research, explanations, and answering questions on any topic.
- Writing help: drafting messages to leads/students, content, emails, summaries.

Style: warm, clear, concise, practical. Use Ghanaian context where relevant (GHS pricing). If you don't know a CCE-specific fact and it isn't in the knowledge below, say so plainly rather than inventing it. For general-knowledge questions, answer helpfully like a capable assistant.

=== CAMBRIDGE KNOWLEDGE BASE ===
${knowledge || 'No knowledge base entries are configured yet.'}
=== END KNOWLEDGE BASE ===`

  // Keep the last ~12 turns for context
  const trimmed = messages.slice(-12).map((m: any) => ({
    role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: String(m.content || '').slice(0, 4000),
  }))

  const reply = await aiComplete({ system, messages: trimmed, maxTokens: 1200 })
  if (!reply) return NextResponse.json({ error: 'Gyampoh AI could not respond right now. Please try again.' }, { status: 502 })

  return NextResponse.json({ reply })
}
