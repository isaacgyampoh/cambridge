import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { recordEvent } from '@/lib/chatbot/events'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/**
 * Un-pause the assistant on leads it stopped replying to. Use after fixing a
 * fault that caused it to hand off wrongly — leads stay paused until something
 * clears them.
 * GET = how many are paused. POST = resume them all.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { count } = await sb.from('leads')
    .select('id', { count: 'exact', head: true }).eq('ai_paused', true)
  return NextResponse.json({ paused: count || 0 })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  // Leave genuinely converted or dead leads alone.
  const { data, error } = await sb.from('leads')
    .update({ ai_paused: false, needs_human: false, ai_paused_by: null })
    .eq('ai_paused', true)
    .not('status', 'in', '(registered,not_interested,lost)')
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  /*
   * This is the ONLY thing that resumes a paused conversation. Nothing does it
   * on a timer any more — see the state model in lib/aiResume — so each of
   * these is a deliberate decision by a person and belongs on the lead's
   * timeline beside the handover that paused it.
   */
  for (const row of data || []) {
    await recordEvent({ leadId: row.id, event: 'AI_RESUMED', detail: `Resumed by ${s.fullName || s.role}` })
  }

  return NextResponse.json({ success: true, resumed: (data || []).length })
}
