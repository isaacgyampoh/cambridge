import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyStudent, STUDENT_COOKIE } from '@/lib/student/auth'
import crypto from 'crypto'

export const runtime = 'nodejs'

/**
 * Issue a SHORT-LIVED, single-use token for joining class. The Zoom link is
 * never sent to the browser, so it cannot be copied and passed to someone who
 * has not paid. Re-checks payment and cohort validity at the moment of use.
 */
export async function POST(req: NextRequest) {
  const s = await verifyStudent(req.cookies.get(STUDENT_COOKIE)?.value)
  if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: enr } = await sb.from('class_enrollments')
    .select('id, batch_id, total_fee, amount_paid').eq('lead_id', s.leadId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!enr?.batch_id) return NextResponse.json({ error: 'no_class' }, { status: 404 })

  const { data: b } = await sb.from('batches')
    .select('end_date, status, free_sessions, min_payment_per_session, zoom_link').eq('id', enr.batch_id).maybeSingle()
  if (!b?.zoom_link) return NextResponse.json({ error: 'no_link' }, { status: 404 })

  // Cohort over?
  const endsAt = b.end_date ? new Date(b.end_date) : null
  if (endsAt) endsAt.setHours(23, 59, 59, 999)
  if (b.status === 'completed' || (endsAt && endsAt.getTime() < Date.now())) {
    return NextResponse.json({ error: 'cohort_ended' }, { status: 403 })
  }

  // Payment gate — recomputed here, not trusted from the client
  const { count: attended } = await sb.from('class_signins')
    .select('id', { count: 'exact', head: true }).eq('enrollment_id', enr.id)
  const sessionNumber = (attended || 0) + 1
  const freeSessions = Number(b.free_sessions ?? 1)
  const perSession = Number(b.min_payment_per_session ?? 0)
  const paid = Number(enr.amount_paid || 0)
  const totalFee = Number(enr.total_fee || 0)
  if (perSession > 0 && sessionNumber > freeSessions) {
    let required = (sessionNumber - freeSessions) * perSession
    if (totalFee > 0) required = Math.min(required, totalFee)
    if (paid + 0.01 < required) {
      return NextResponse.json({
        error: 'payment_required',
        minTopUp: Math.round((required - paid) * 100) / 100,
      }, { status: 402 })
    }
  }

  const token = crypto.randomBytes(24).toString('hex')
  await sb.from('class_access_tokens').insert({
    token, lead_id: s.leadId, batch_id: enr.batch_id,
    expires_at: new Date(Date.now() + 3 * 60000).toISOString(),  // 3 minutes
  })

  return NextResponse.json({ success: true, url: `/class/${token}` })
}
