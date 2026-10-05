import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { REMINDERS_KEY, remindersEnabled } from '@/lib/payments/reminderPolicy'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'accountant']

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED.includes(session.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: fees } = await sb.from('student_fees')
    .select('student_name, phone, total_fee, amount_paid').limit(5000)

  const owing = (fees || [])
    .map((f: any) => ({ name: f.student_name, phone: f.phone, balance: Number(f.total_fee || 0) - Number(f.amount_paid || 0) }))
    .filter((f: any) => f.balance > 0.01 && f.phone)
    .sort((a: any, b: any) => b.balance - a.balance)

  const totalOwed = owing.reduce((sum: number, f: any) => sum + f.balance, 0)

  // So the page can say reminders are off BEFORE anyone presses Send, rather
  // than reporting "sent to 0 students" afterwards.
  let enabled = false
  try {
    const { data } = await sb.from('settings')
      .select('value').eq('key', REMINDERS_KEY).maybeSingle()
    enabled = remindersEnabled(data?.value ?? null)
  } catch { enabled = false }

  return NextResponse.json({
    enabled,
    owingCount: owing.length,
    totalOwed: Math.round(totalOwed),
    sample: owing.slice(0, 8).map((f: any) => ({ name: f.name, balance: f.balance })),
  })
}
