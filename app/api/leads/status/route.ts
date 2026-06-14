import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * UNIFIED lead status change — the single path every page uses.
 * Body: { leadId, status, programCode?, delivery?, corporateValue? }
 *
 * Whenever a lead becomes 'registered', this credits remuneration points
 * + the GHS 200 registration commission to the responsible marketer —
 * no matter where the change came from (pipeline drag, dropdown, modal,
 * or an automated system flow). One flow, always aligned.
 *
 * If status -> registered but no programCode is given, we try to match
 * the lead's course_interest to a programme automatically. If we can't,
 * we return needsProgram:true so the caller can ask which programme.
 */

// Map free-text course interest to a programme code
function matchProgram(courseInterest: string | null, programs: any[]): any | null {
  if (!courseInterest) return null
  const t = courseInterest.toLowerCase()
  // direct code/name contains
  for (const p of programs) {
    if (t.includes(p.code.toLowerCase()) || t.includes(p.name.toLowerCase())) return p
  }
  // keyword heuristics
  const map: Record<string, string> = {
    'pmp': 'PMP', 'project management': 'PMP',
    'sphr': 'SPHRI', 'phri': 'SPHRI', 'hr': 'SPHRI', 'human resource': 'SPHRI',
    'aphri': 'APHRI',
    'capm': 'CAPM',
    'ngo': 'NGO',
    'project financing': 'PROJFIN', 'financing': 'PROJFIN', 'finance': 'PROJFIN',
    'ms project': 'MSPROJ', 'microsoft project': 'MSPROJ',
    'commercial law': 'COMLAW', 'law': 'COMLAW',
    'instructor': 'INSTR',
    'corporate': 'CORP',
  }
  for (const [kw, code] of Object.entries(map)) {
    if (t.includes(kw)) { const p = programs.find(x => x.code === code); if (p) return p }
  }
  return null
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, status, programCode, delivery = 'in_person', corporateValue, marketerId } = await req.json()
  if (!leadId || !status) return NextResponse.json({ error: 'Missing leadId or status' }, { status: 400 })

  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads')
    .select('id, full_name, assigned_to, status, course_interest').eq('id', leadId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const wasRegistered = lead.status === 'registered'
  const becomingRegistered = status === 'registered' && !wasRegistered

  // ── Registration path: credit points + commission ──
  if (becomingRegistered) {
    // Has this lead already been credited (any program)? Avoid double credit.
    const { data: already } = await sb.from('marketer_enrollments')
      .select('id').eq('lead_id', leadId).limit(1).maybeSingle()

    if (!already) {
      const { data: programs } = await sb.from('program_points').select('*').eq('is_active', true)
      let prog = programCode ? (programs || []).find((p: any) => p.code === programCode) : null
      if (!prog) prog = matchProgram(lead.course_interest, programs || [])

      // Couldn't determine the programme — ask the caller
      if (!prog) {
        return NextResponse.json({
          needsProgram: true,
          message: 'Select the programme this student registered for to credit points.',
          programs: (programs || []).map((p: any) => ({ code: p.code, name: p.name, points: p.points, is_corporate: p.is_corporate })),
        })
      }

      let points = Number(prog.points || 0)
      if (prog.is_corporate) {
        const cv = Number(corporateValue || 0)
        points = Math.max(40, Math.min(200, cv || 40))
      }

      const creditTo = marketerId || lead.assigned_to || session.userId

      await sb.from('marketer_enrollments').insert({
        marketer_id: creditTo, lead_id: leadId,
        program_code: prog.code, program_name: prog.name,
        points, registration_fee: 200, delivery,
        is_pipeline: false, year: new Date().getFullYear(),
        created_by: session.userId,
      })

      await sb.from('lead_activities').insert({
        lead_id: leadId, activity_type: 'note', subject: 'Registered',
        description: `Enrolled in ${prog.name} (${delivery.replace('_', ' ')}). ${points} points + GHS 200 credited.`,
        created_by: session.userId,
      })

      if (creditTo) {
        await sb.from('notifications').insert({
          user_id: creditTo, type: 'points',
          title: `+${points} points earned`,
          body: `${lead.full_name} registered for ${prog.name}. ${points} points + GHS 200 registration added to your annual total.`,
          link: '/marketer/earnings',
        })
      }
    }
  }

  // ── Apply the status change (all paths) ──
  await sb.from('leads').update({ status }).eq('id', leadId)

  // Log status transitions other than registration (already logged above)
  if (!becomingRegistered && status !== lead.status) {
    await sb.from('lead_status_logs').insert({
      lead_id: leadId, from_status: lead.status, to_status: status, changed_by: session.userId,
    }).then(() => {}, () => {})
  }

  return NextResponse.json({ success: true, status, credited: becomingRegistered })
}
