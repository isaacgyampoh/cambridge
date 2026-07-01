import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { aiComplete, aiConfigured } from '@/lib/integrations/ai-client'
import { toolsForRole, runTool } from '@/lib/assistant/tools'

export const runtime = 'nodejs'

/**
 * Gyampoh AI — data-powered, role-aware staff assistant.
 * Flow: the model may ask to run ONE data tool (already scoped to the user's
 * role). We run it, feed the result back, and the model answers in plain
 * language. It also answers general/research/writing questions directly.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'Please sign in' }, { status: 401 })
  if (!aiConfigured()) return NextResponse.json({ error: 'The AI is not configured yet.' }, { status: 503 })

  const { messages } = await req.json()
  if (!Array.isArray(messages) || !messages.length) return NextResponse.json({ error: 'No message' }, { status: 400 })

  const sb = createServiceClient()
  const ctx = { userId: session.userId, role: session.role, fullName: session.fullName }
  const name = session.fullName?.split(' ')[0] || 'there'

  // Knowledge base grounding
  let knowledge = ''
  try {
    const { data: kb } = await sb.from('knowledge_base').select('question, answer').eq('is_active', true).limit(60)
    if (kb?.length) knowledge = kb.map((k: any) => `Q: ${k.question}\nA: ${k.answer}`).join('\n\n')
  } catch {}

  const availableTools = toolsForRole(ctx.role)

  const system = `You are Gyampoh AI, the INTERNAL assistant for Cambridge Centre of Excellence (CCE) staff. You are NOT a public/marketing chatbot — you are a private tool for staff to find real answers from our live system. You are speaking with ${name}, whose role is "${ctx.role}".

CORE RULE — ALWAYS CHECK THE SYSTEM:
Any question about the CURRENT STATE of CCE — admissions, leads, students, payments, attendance, registrations, who owes, how many of anything — MUST be answered from live data using a tool. NEVER answer these from memory or give a generic reply. If someone asks "do we have pending admissions?", you MUST call the admissions_status tool and answer with the real number ("Yes, 4 pending" or "No, none pending right now"). If they ask "has anyone registered?", check the data. Treat every "do we have…", "how many…", "who…", "is there any…" question as a data lookup.

You do these things:
1. ANSWER DATA QUESTIONS from the live system via a tool (see below) — this is your main job.
2. Answer questions about CCE courses/fees/process using the knowledge base.
3. Help with strategy, advice, and writing (messages to leads, content) — like a sharp internal colleague.

DATA TOOLS available to this user (based on their role):
${availableTools.map(t => `- ${t.name}: ${t.description} params: ${JSON.stringify(t.parameters)}`).join('\n') || '(none)'}

When the question needs live data, respond with ONLY a JSON object on a single line, nothing else:
{"tool":"<tool_name>","args":{...}}
No words around the JSON. If a tool exists that could answer, USE IT rather than guessing. Only if genuinely no tool fits AND it's not a data question do you answer in prose. If the user's role can't access something, say so plainly.

Style: warm, direct, concise, Ghanaian context (GHS). Never invent data. If a tool returns zero, say so clearly (e.g. "No pending admissions right now.").

=== CCE KNOWLEDGE BASE ===
${knowledge || 'No knowledge base entries configured yet.'}
=== END ===`

  const history = messages.slice(-12).map((m: any) => ({
    role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: String(m.content || '').slice(0, 4000),
  }))

  // First pass — the model may answer directly OR request a tool
  const first = await aiComplete({ system, messages: history, maxTokens: 1000 })
  if (!first) return NextResponse.json({ error: 'Gyampoh AI could not respond right now.' }, { status: 502 })

  // Did it request a tool?
  const toolReq = tryParseTool(first)
  if (!toolReq) {
    return NextResponse.json({ reply: first })
  }

  // Run the tool (role-checked inside)
  const result = await runTool(toolReq.tool, toolReq.args, ctx)

  // Second pass — explain the data in plain language
  const followup = await aiComplete({
    system,
    messages: [
      ...history,
      { role: 'assistant', content: `I looked this up. Raw result: ${JSON.stringify(result)}` },
      { role: 'user', content: 'Now answer my question in clear, friendly plain language using that result. Do not show JSON. If there was an error or no data, explain simply.' },
    ],
    maxTokens: 1000,
  })

  return NextResponse.json({ reply: followup || 'I found the data but had trouble summarising it. Please try again.' })
}

// Extract a {"tool":...} request if the model returned one
function tryParseTool(text: string): { tool: string; args: any } | null {
  const t = text.trim()
  const match = t.match(/\{[\s\S]*"tool"[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} }
  } catch {}
  return null
}
