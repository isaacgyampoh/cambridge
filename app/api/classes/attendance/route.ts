import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Class attendance for a given batch + date.
 * - Admin/PM/finance/reception/trainer see the full roster (present/absent).
 * - A marketer sees only THEIR students (those they registered): who came,
 *   who was absent, so they can call the absentees.
 * Query: ?batchId=...&date=YYYY-MM-DD (date optional, defaults to today)
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '', userId: '' }
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const batchId = url.searchParams.get('batchId')
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  if (!batchId) return NextResponse.json({ error: 'Missing batchId' }, { status: 400 })

  const sb = createServiceClient()
  const isMarketer = session.role === 'marketing_officer'

  // Roster with the registering marketer
  const { data: roster } = await sb.from('class_enrollments')
    .select('id, full_name, phone, balance, total_fee, amount_paid, application:application_id(marketer_id)')
    .eq('batch_id', batchId).eq('status', 'active')

  // Today's sign-ins
  const { data: signins } = await sb.from('class_signins')
    .select('enrollment_id').eq('batch_id', batchId).eq('session_date', date)
  const present = new Set((signins || []).map((s: any) => s.enrollment_id))

  let list = (roster || [])
  if (isMarketer) {
    list = list.filter((s: any) => (s as any).application?.marketer_id === session.userId)
  }

  const students = list.map((s: any) => ({
    enrollmentId: s.id, name: s.full_name, phone: s.phone,
    balance: Number(s.balance ?? ((s.total_fee || 0) - (s.amount_paid || 0))) || 0,
    present: present.has(s.id),
  }))

  return NextResponse.json({
    date,
    total: students.length,
    presentCount: students.filter(s => s.present).length,
    absentCount: students.filter(s => !s.present).length,
    students,
    scope: isMarketer ? 'mine' : 'all',
  })
}
