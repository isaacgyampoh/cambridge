import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { chatbotOpening, buildLeadContext } from '@/lib/chatbot'
import { aiConfigured } from '@/lib/integrations/ai-client'
import { SECRETS } from '@/lib/config.server'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * Prove the AI leg works without messaging a real lead: generates the exact
 * opening message a new lead would receive and returns it as text.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const configured = aiConfigured()
  if (!configured) {
    return NextResponse.json({
      ok: false,
      key_set: !!SECRETS.openaiApiKey,
      enabled: SECRETS.aiAssistantEnabled,
      diagnosis: !SECRETS.openaiApiKey
        ? 'OPENAI_API_KEY is not reaching the server. Add it in Vercel and redeploy.'
        : 'AI replies are switched off in config.',
    })
  }

  const started = Date.now()
  let message: string | null = null
  let error: string | null = null
  try {
    // A real context, so the sample shows what a lead would actually get —
    // including the numbered options, which depend on the live programme data.
    const ctx = await buildLeadContext({
      lead: { id: 'preview', full_name: 'Kwame Boateng', course_interest: 'Projects Management Professional (PMP)' },
    })
    message = (await chatbotOpening(ctx))?.text || null
  } catch (e: any) { error = e?.message || 'AI call failed' }

  return NextResponse.json({
    ok: !!message,
    model: SECRETS.openaiModel,
    took_ms: Date.now() - started,
    sample_message: message,
    error,
    diagnosis: message
      ? 'AI is working. This is what a new lead would receive.'
      : (error || 'The AI returned nothing — check the API key is valid and has credit.'),
  })
}
