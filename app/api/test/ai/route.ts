import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { generateOpeningMessage } from '@/lib/integrations/ai-assistant'
import { aiConfigured } from '@/lib/integrations/ai-client'
import { CONFIG } from '@/lib/config'

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
      key_set: !!CONFIG.openaiApiKey,
      enabled: CONFIG.aiAssistantEnabled,
      diagnosis: !CONFIG.openaiApiKey
        ? 'OPENAI_API_KEY is not reaching the server. Add it in Vercel and redeploy.'
        : 'AI replies are switched off in config.',
    })
  }

  const started = Date.now()
  let message: string | null = null
  let error: string | null = null
  try {
    message = await generateOpeningMessage({
      leadName: 'Kwame Boateng',
      marketerName: 'Ama',
      courseInterest: 'Projects Management Professional (PMP)',
    })
  } catch (e: any) { error = e?.message || 'AI call failed' }

  return NextResponse.json({
    ok: !!message,
    model: CONFIG.openaiModel,
    took_ms: Date.now() - started,
    sample_message: message,
    error,
    diagnosis: message
      ? 'AI is working. This is what a new lead would receive.'
      : (error || 'The AI returned nothing — check the API key is valid and has credit.'),
  })
}
