import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyStudent, STUDENT_COOKIE } from '@/lib/student/auth'
import { releaseMaterialsFor } from '@/lib/materialRelease'

export const runtime = 'nodejs'

/** Everything the student portal shows: class, balance, materials, payments. */
export async function GET(req: NextRequest) {
  const s = await verifyStudent(req.cookies.get(STUDENT_COOKIE)?.value)
  if (!s) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads')
    .select('id, full_name, phone, course_interest, assigned_to').eq('id', s.leadId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  // Fee ledger
  const { data: fee } = await sb.from('student_fees')
    .select('id, course_id, course_name, total_fee, amount_paid, balance, status, delivery')
    .eq('lead_id', s.leadId).maybeSingle()

  // Their class (enrollment -> batch)
  const { data: enr } = await sb.from('class_enrollments')
    .select('id, batch_id, total_fee, amount_paid, balance')
    .eq('lead_id', s.leadId).order('created_at', { ascending: false }).limit(1).maybeSingle()

  let batch: any = null
  let sessionInfo: any = null
  if (enr?.batch_id) {
    const { data: b } = await sb.from('batches')
      .select('id, name, schedule, start_date, end_date, status, zoom_link, class_type, free_sessions, min_payment_per_session, courses(name)')
      .eq('id', enr.batch_id).maybeSingle()
    batch = b

    // How many sessions attended, and what's required for the next one
    const { count: attended } = await sb.from('class_signins')
      .select('id', { count: 'exact', head: true }).eq('enrollment_id', enr.id)
    const sessionNumber = (attended || 0) + 1
    const freeSessions = Number(b?.free_sessions ?? 1)
    const perSession = Number(b?.min_payment_per_session ?? 0)
    const paid = Number(enr.amount_paid || 0)
    const totalFee = Number(enr.total_fee || fee?.total_fee || 0)

    let requiredTotal = 0
    if (perSession > 0 && sessionNumber > freeSessions) {
      requiredTotal = (sessionNumber - freeSessions) * perSession
      if (totalFee > 0) requiredTotal = Math.min(requiredTotal, totalFee)
    }
    const minTopUp = Math.max(0, Math.round((requiredTotal - paid) * 100) / 100)

    // Already signed in today?
    const today = new Date().toISOString().slice(0, 10)
    const { data: todaySignin } = await sb.from('class_signins')
      .select('id').eq('enrollment_id', enr.id).eq('session_date', today).maybeSingle()

    // ── COHORT ACCESS ──
    // One fixed class link for the whole cohort, but access ends when the
    // cohort does: past the end date (or once marked completed) the link is
    // withheld and they must contact administration to rejoin a new cohort.
    const endsAt = b?.end_date ? new Date(b.end_date) : null
    if (endsAt) endsAt.setHours(23, 59, 59, 999)
    const cohortEnded = (b?.status === 'completed') || (!!endsAt && endsAt.getTime() < Date.now())

    sessionInfo = {
      sessionNumber, freeSessions, requiredTotal, minTopUp,
      cohortEnded,
      endDate: b?.end_date || null,
      canJoin: !cohortEnded && minTopUp <= 0,
      signedInToday: !!todaySignin,
      // The Zoom link is deliberately NOT sent to the browser — joining goes
      // through a single-use redirect so a copied URL is worthless.
      hasLink: !!b?.zoom_link,
    }
  }

  // Materials: unlocked now, plus what's still locked and what unlocks it
  let unlocked: any[] = [], locked: any[] = []
  try {
    const r = await releaseMaterialsFor(s.leadId, { notify: false })
    // The file address is deliberately NOT sent — materials are viewed through
    // the portal so they cannot be forwarded or resold.
    unlocked = (r.materials || []).map((m: any) => ({ id: m.id, name: m.name }))
    const paid = Number(fee?.amount_paid || 0)
    const { data: allDocs } = await sb.from('documents')
      .select('id, name, unlock_after_amount, course_id')
      .eq('type', 'course_material').order('unlock_after_amount', { ascending: true }).limit(200)
    locked = (allDocs || [])
      .filter((d: any) => (!d.course_id || d.course_id === fee?.course_id) && Number(d.unlock_after_amount || 0) > paid)
      .map((d: any) => ({ name: d.name, unlockAt: Number(d.unlock_after_amount || 0) }))
  } catch {}

  // Certificate — released only when fees are fully paid AND it's been issued
  let certificate: any = null
  let certificateState: string = 'unknown'
  try {
    // Available once fees are cleared AND the course is nearly done — from the
    // last two sessions onward, rather than only after the very end.
    const feesCleared = fee ? Number(fee.balance ?? 0) <= 0 : false
    let nearlyDone = false
    if (enr?.batch_id) {
      const { data: b } = await sb.from('batches')
        .select('end_date, status, total_sessions').eq('id', enr.batch_id).maybeSingle()
      const { count: attended } = await sb.from('class_signins')
        .select('id', { count: 'exact', head: true }).eq('enrollment_id', enr.id)
      const total = Number((b as any)?.total_sessions || 0)
      const done = (b as any)?.status === 'completed'
      const endingSoon = (b as any)?.end_date
        ? new Date((b as any).end_date).getTime() - Date.now() < 14 * 86400000
        : false
      nearlyDone = done || endingSoon || (total > 0 && (attended || 0) >= total - 2)
    }
    certificateState = !feesCleared
      ? 'fees_outstanding'
      : !nearlyDone ? 'too_early' : 'ready'

    if (feesCleared && nearlyDone) {
      const { data: cert } = await sb.from('certificates')
        .select('certificate_number, final_url, issued_date, course_name')
        .eq('lead_id', s.leadId).order('issued_date', { ascending: false }).limit(1).maybeSingle()
      if (cert?.final_url) certificate = cert
    }
  } catch {}

  // Payment history
  const { data: payments } = await sb.from('payments')
    .select('amount, method, receipt_number, created_at')
    .eq('lead_id', s.leadId).order('created_at', { ascending: false }).limit(20)

  return NextResponse.json({
    student: { name: lead.full_name, phone: lead.phone },
    course: fee?.course_name || (batch as any)?.courses?.name || lead.course_interest || null,
    fee: fee ? {
      total: Number(fee.total_fee || 0),
      paid: Number(fee.amount_paid || 0),
      balance: Number(fee.balance ?? 0),
      status: fee.status,
    } : null,
    batch: batch ? {
      id: batch.id, name: batch.name, schedule: batch.schedule,
      startDate: batch.start_date, type: batch.class_type,
    } : null,
    session: sessionInfo,
    enrollmentId: enr?.id || null,
    materials: { unlocked, locked },
    certificate,
    certificateState,
    payments: payments || [],
  })
}
