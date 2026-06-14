import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Unified registrations feed — the single source of truth for "who has
 * registered". Both Finance and Admissions read from this.
 *
 * Each row = a registered student with: their marketer (assigned by),
 * the programme, points earned, the GHS 200 registration fee, delivery,
 * payment reference and date.
 *
 * Finance uses this to know whose registration money is whose (e.g.
 * "Kofi registered 4 people = Kofi's commission"). Admissions uses it to
 * process the newly registered students.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only finance, marketers, PMs and super admin see registration money.
  // Academics/admissions/reception have no business with the amounts.
  const canSeeMoney = ['super_admin', 'accountant', 'marketing_officer', 'project_manager'].includes(session.role || '')
  if (!canSeeMoney) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })

  const url = new URL(req.url)
  const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()))

  const sb = createServiceClient()

  // marketer_enrollments is the record of every registration (points + fee)
  const { data: enrollments } = await sb.from('marketer_enrollments')
    .select('*, marketer:marketer_id(full_name, phone), lead:lead_id(full_name, phone, email, course_interest)')
    .eq('year', year)
    .order('created_at', { ascending: false })

  // Match payments by lead (via application) for reference/receipt
  const { data: payments } = await sb.from('payments')
    .select('id, amount, paystack_ref, receipt_number, paid_at, application_id, status')
    .eq('status', 'paid')

  const registrations = (enrollments || []).map((e: any) => {
    return {
      id: e.id,
      studentName: e.lead?.full_name || 'Unknown',
      studentPhone: e.lead?.phone || '',
      studentEmail: e.lead?.email || '',
      program: e.program_name,
      programCode: e.program_code,
      points: Number(e.points || 0),
      registrationFee: Number(e.registration_fee || 0),
      delivery: e.delivery,
      marketerId: e.marketer_id,
      marketerName: e.marketer?.full_name || 'Unassigned',
      registeredAt: e.created_at,
    }
  })

  // Per-marketer commission summary (whose money is whose)
  const byMarketer: Record<string, { name: string; count: number; commission: number; points: number }> = {}
  registrations.forEach(r => {
    const k = r.marketerId || 'unassigned'
    if (!byMarketer[k]) byMarketer[k] = { name: r.marketerName, count: 0, commission: 0, points: 0 }
    byMarketer[k].count++
    byMarketer[k].commission += r.registrationFee
    byMarketer[k].points += r.points
  })

  const totals = {
    students: registrations.length,
    commission: registrations.reduce((a, r) => a + r.registrationFee, 0),
    points: registrations.reduce((a, r) => a + r.points, 0),
  }

  return NextResponse.json({
    registrations,
    byMarketer: Object.entries(byMarketer).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count),
    totals,
    year,
  })
}
