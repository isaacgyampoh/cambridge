import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * [DEPRECATED for normal flow] Manual points-credit endpoint.
 *
 * The canonical path is now POST /api/leads/status with status:'registered',
 * which credits points for EVERY registration regardless of source or screen.
 * This endpoint is kept only for ad-hoc/manual admin crediting and is not
 * called by the UI. Prefer /api/leads/status.
 *
 * Credit a points-earning enrollment to a marketer when a lead registers.
 * Body: { leadId, programCode, delivery, marketerId?, corporateValue?, isPipeline? }
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, programCode, delivery = 'in_person', marketerId, corporateValue, isPipeline = false } = await req.json()
  if (!leadId || !programCode) return NextResponse.json({ error: 'Missing leadId or programCode' }, { status: 400 })

  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads').select('id, full_name, assigned_to, status').eq('id', leadId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // The marketer credited = explicit, else the lead's assignee, else current user
  const creditTo = marketerId || lead.assigned_to || session.userId

  // Prevent double-crediting the same lead+program
  const { data: existing } = await sb.from('marketer_enrollments')
    .select('id').eq('lead_id', leadId).eq('program_code', programCode).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'This lead has already been credited for this program.' }, { status: 400 })
  }

  // Resolve the program's point value
  const { data: prog } = await sb.from('program_points').select('*').eq('code', programCode).maybeSingle()
  if (!prog) return NextResponse.json({ error: 'Unknown program' }, { status: 400 })

  let points = Number(prog.points || 0)
  if (prog.is_corporate) {
    const cv = Number(corporateValue || 0)
    points = Math.max(40, Math.min(200, cv || 40))   // corporate is a 40–200 quantitative valuation
  }

  // Record the enrollment
  const { error: insErr } = await sb.from('marketer_enrollments').insert({
    marketer_id: creditTo,
    lead_id: leadId,
    program_code: programCode,
    program_name: prog.name,
    points,
    registration_fee: 200,
    delivery,
    is_pipeline: isPipeline,
    year: new Date().getFullYear(),
    created_by: session.userId,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Move lead to registered
  await sb.from('leads').update({ status: 'registered' }).eq('id', leadId)

  // Log activity
  await sb.from('lead_activities').insert({
    lead_id: leadId, activity_type: 'note',
    subject: 'Registered',
    description: `Enrolled in ${prog.name} (${delivery.replace('_', ' ')}). ${points} points credited.`,
    created_by: session.userId,
  })

  // Notify the marketer
  if (creditTo) {
    await sb.from('notifications').insert({
      user_id: creditTo, type: 'points',
      title: `+${points} points earned`,
      body: `${lead.full_name} registered for ${prog.name}. ${points} points + GHS 200 registration added to your annual total.`,
      link: '/marketer/earnings',
    })
  }

  return NextResponse.json({ success: true, points, program: prog.name })
}
