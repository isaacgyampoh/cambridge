import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

/**
 * Finance marks a marketer's registration commission as paid out.
 * Body: { marketerId, year } — marks all that marketer's unpaid
 * registrations for the year as commission_paid, and notifies them.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only finance / super admin can disburse
  if (!['super_admin', 'accountant'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Only finance can mark commissions paid' }, { status: 403 })
  }

  const { marketerId, year } = await req.json()
  if (!marketerId) return NextResponse.json({ error: 'Missing marketerId' }, { status: 400 })
  const yr = year || new Date().getFullYear()

  const sb = createServiceClient()

  // Sum what's about to be paid
  const { data: pending } = await sb.from('marketer_enrollments')
    .select('registration_fee')
    .eq('marketer_id', marketerId).eq('year', yr).eq('commission_paid', false)
  const amount = (pending || []).reduce((a: number, e: any) => a + Number(e.registration_fee || 0), 0)
  const count = (pending || []).length

  if (count === 0) return NextResponse.json({ error: 'Nothing outstanding for this marketer' }, { status: 400 })

  await sb.from('marketer_enrollments').update({
    commission_paid: true,
    commission_paid_at: new Date().toISOString(),
    commission_paid_by: session.userId,
  }).eq('marketer_id', marketerId).eq('year', yr).eq('commission_paid', false)

  await sb.from('notifications').insert({
    user_id: marketerId, type: 'commission_paid',
    title: 'Registration commission paid',
    body: `Finance has paid your registration commission of GHS ${amount.toLocaleString()} for ${count} student${count === 1 ? '' : 's'}.`,
    link: '/marketer/earnings',
  })

  return NextResponse.json({ success: true, amount, count })
}
