import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Exam prep tracker.
 * GET  — prep records. Coordinators see only their programme; super admin
 *        and PM see all. Also returns "eligible" completed students not yet
 *        in the tracker (so the coordinator can add them).
 * POST — add a student to the tracker / update a record / remove.
 */

function coordProgram(session: any) {
  return session.role === 'exam_coordinator' ? (session.coordinatorProgram || null) : null
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isPriv = ['super_admin', 'project_manager'].includes(session.role || '')
  const isCoord = session.role === 'exam_coordinator'
  if (!isPriv && !isCoord) return NextResponse.json({ error: 'Not permitted' }, { status: 403 })

  const sb = createServiceClient()

  // Resolve coordinator's programme from their profile
  let myProgram: string | null = null
  if (isCoord) {
    const { data: me } = await sb.from('profiles').select('coordinator_program').eq('id', session.userId).maybeSingle()
    myProgram = me?.coordinator_program || null
  }

  // Prep records in scope
  let q = sb.from('prep_records').select('*').order('updated_at', { ascending: false })
  if (isCoord && myProgram) q = q.eq('program_code', myProgram)
  const { data: records } = await q

  // Eligible: completed class enrollments whose programme matches, not yet tracked
  const trackedEnroll = new Set((records || []).map((r: any) => r.enrollment_id).filter(Boolean))
  let eq = sb.from('class_enrollments')
    .select('*, batch:batch_id(name, course:course_id(name, code))')
    .eq('status', 'completed')
  const { data: completed } = await eq
  const eligible = (completed || []).filter((e: any) => {
    if (trackedEnroll.has(e.id)) return false
    if (isCoord && myProgram) {
      const code = e.batch?.course?.code || ''
      return code.toUpperCase() === myProgram.toUpperCase()
    }
    return true
  })

  return NextResponse.json({ records: records || [], eligible, myProgram, scope: isPriv ? 'all' : 'mine' })
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'project_manager', 'exam_coordinator'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const body = await req.json()
  const sb = createServiceClient()

  if (body.action === 'add') {
    // Pull the enrollment to seed the record
    const { data: enr } = await sb.from('class_enrollments')
      .select('*, batch:batch_id(course:course_id(name, code))').eq('id', body.enrollmentId).maybeSingle()
    if (!enr) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

    const code = (enr as any).batch?.course?.code || null
    const name = (enr as any).batch?.course?.name || null

    // Auto-assign coordinator: the profile whose coordinator_program matches
    let coordinatorId: string | null = null
    if (code) {
      const { data: coord } = await sb.from('profiles').select('id')
        .eq('role', 'exam_coordinator').eq('coordinator_program', code).maybeSingle()
      coordinatorId = coord?.id || null
    }

    const { data, error } = await sb.from('prep_records').insert({
      enrollment_id: enr.id, application_id: enr.application_id, lead_id: enr.lead_id,
      student_name: enr.full_name, email: enr.email, phone: enr.phone,
      program_code: code, program_name: name, coordinator_id: coordinatorId,
      prep_status: 'ongoing',
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logPrep(sb, data.id, session, code, enr.full_name, 'added', `Added ${enr.full_name} to ${name || code || 'prep'} tracking`)
    return NextResponse.json({ success: true, record: data })
  }

  if (body.action === 'update') {
    const { id, ...fields } = body
    delete fields.action
    fields.updated_at = new Date().toISOString()
    // Capture what's being changed for the activity log
    const { data: before } = await sb.from('prep_records').select('*').eq('id', id).maybeSingle()
    const { error } = await sb.from('prep_records').update(fields).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Build a human description of the change
    const changes: string[] = []
    for (const k of Object.keys(fields)) {
      if (k === 'updated_at') continue
      const oldV = before?.[k]
      const newV = (fields as any)[k]
      if (String(oldV ?? '') !== String(newV ?? '')) {
        if (k === 'comment') changes.push(`Comment: "${newV}"`)
        else changes.push(`${k.replace(/_/g, ' ')} → ${newV}`)
      }
    }
    const action = fields.comment !== undefined && Object.keys(fields).filter(k => k !== 'updated_at' && k !== 'comment').length === 0 ? 'comment' : 'updated'
    await logPrep(sb, id, session, before?.program_code || null, before?.student_name || null, action, changes.join('; ') || 'Updated record')
    return NextResponse.json({ success: true })
  }

  if (body.action === 'remove') {
    const { data: before } = await sb.from('prep_records').select('*').eq('id', body.id).maybeSingle()
    await sb.from('prep_records').delete().eq('id', body.id)
    if (before) await logPrep(sb, body.id, session, before.program_code, before.student_name, 'removed', `Removed ${before.student_name} from tracking`)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// Log a coordinator action so the PM/admin can see all prep activity.
async function logPrep(sb: any, prepRecordId: string, session: any, programCode: string | null, studentName: string | null, action: string, detail: string) {
  try {
    await sb.from('prep_activity').insert({
      prep_record_id: prepRecordId,
      actor_id: session.userId,
      actor_name: session.fullName || null,
      program_code: programCode,
      student_name: studentName,
      action,
      detail,
    })
  } catch { /* logging is best-effort, never block the action */ }
}
