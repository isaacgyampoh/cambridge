import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** A marketer/staff files their own manual report for a period. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const { period, note } = await req.json()
  if (!note?.trim()) return NextResponse.json({ error: 'Write your report first.' }, { status: 400 })
  const p = ['daily', 'weekly', 'monthly'].includes(period) ? period : 'daily'

  const now = new Date()
  let start = new Date()
  if (p === 'daily') start.setHours(0, 0, 0, 0)
  else if (p === 'weekly') start.setDate(now.getDate() - 7)
  else start.setMonth(now.getMonth() - 1)

  const sb = createServiceClient()
  const { error } = await sb.from('marketer_reports').upsert({
    marketer_id: s.userId, period: p,
    period_start: start.toISOString().slice(0, 10),
    period_end: now.toISOString().slice(0, 10),
    is_manual: true, manual_note: note.trim(),
    summary: note.trim().slice(0, 200),
  }, { onConflict: 'marketer_id,period,period_start' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify PMs so they see the manual report
  const { data: mgrs } = await sb.from('profiles').select('id').in('role', ['super_admin', 'project_manager']).eq('is_active', true).limit(10)
  for (const m of mgrs || []) {
    await sb.from('notifications').insert({
      user_id: m.id, type: 'report', title: 'A staff report was filed',
      body: `${s.fullName || 'A marketer'} filed a ${p} report.`, link: '/reports',
    }).then(() => {}, () => {})
  }
  return NextResponse.json({ success: true })
}
