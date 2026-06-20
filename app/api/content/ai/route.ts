import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { generateContent } from '@/lib/integrations/content-ai'
import { createServiceClient } from '@/lib/supabase/server'

const ALLOWED = ['super_admin', 'project_manager', 'content_manager']

/**
 * AI content assistant for the content studio.
 * Body: { task: 'write'|'critique'|'improve'|'hashtags'|'ideas', input, platform? }
 * Pulls the knowledge base as factual context so the AI doesn't invent
 * prices/dates.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !ALLOWED.includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { task, input, platform } = await req.json()
  if (!task || !input?.trim()) return NextResponse.json({ error: 'Missing task or input' }, { status: 400 })

  // Factual grounding: pull active knowledge base entries
  let context = ''
  try {
    const sb = createServiceClient()
    const { data: kb } = await sb.from('knowledge_base').select('question, answer').eq('is_active', true).limit(40)
    context = (kb || []).map((k: any) => `${k.question ? k.question + ': ' : ''}${k.answer}`).join('\n')
  } catch { /* context optional */ }

  const result = await generateContent(task, input, platform, context)
  if (!result) return NextResponse.json({ error: 'AI is not configured. Add the Anthropic API key in settings.' }, { status: 503 })
  return NextResponse.json({ result })
}
