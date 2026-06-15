import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Enroll a lead into a drip sequence. Body: { leadId, sequenceId }
 * Schedules the first step using its delay (or immediately if delay 0).
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, sequenceId } = await req.json()
  if (!leadId || !sequenceId) return NextResponse.json({ error: 'Missing leadId or sequenceId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: steps } = await sb.from('sequence_steps')
    .select('delay_hours').eq('sequence_id', sequenceId).order('step_order', { ascending: true }).limit(1)
  const firstDelay = steps?.[0]?.delay_hours ?? 0
  const nextRun = new Date(Date.now() + firstDelay * 3600000).toISOString()

  const { error } = await sb.from('sequence_enrollments').upsert({
    sequence_id: sequenceId, lead_id: leadId,
    current_step: 0, next_run_at: nextRun, status: 'active',
  }, { onConflict: 'sequence_id,lead_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, nextRun })
}
