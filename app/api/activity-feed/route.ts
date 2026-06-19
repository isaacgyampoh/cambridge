import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/pin'

// Unified recent-activity feed across the system
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()

  const safe = async (q: any) => { try { return await q } catch { return { data: [] } } }

  const [leads, payments, admissions, signins, attendance] = await Promise.all([
    safe(sb.from('leads').select('id, full_name, source, created_at').order('created_at', { ascending: false }).limit(8)),
    safe(sb.from('payments').select('id, amount, status, created_at, student:student_id(full_name)').eq('status', 'paid').order('created_at', { ascending: false }).limit(8)),
    safe(sb.from('admissions').select('id, status, created_at, lead:lead_id(full_name)').order('created_at', { ascending: false }).limit(8)),
    safe(sb.from('class_signins').select('id, student_name, signed_in_at').order('signed_in_at', { ascending: false }).limit(8)),
    safe(sb.from('staff_attendance').select('id, clock_in_at, status, staff:staff_id(full_name)').order('clock_in_at', { ascending: false }).limit(8)),
  ])

  const events: any[] = []

  ;(leads.data || []).forEach((l: any) => events.push({
    type: 'lead', icon: 'lead', title: `New lead: ${l.full_name}`, sub: `via ${l.source}`, at: l.created_at,
  }))
  ;(payments.data || []).forEach((p: any) => events.push({
    type: 'payment', icon: 'payment', title: `Payment received`, sub: `GHS ${Number(p.amount).toLocaleString()} from ${p.student?.full_name || 'student'}`, at: p.created_at,
  }))
  ;(admissions.data || []).forEach((a: any) => events.push({
    type: 'admission', icon: 'admission', title: `Admission ${a.status?.replace(/_/g, ' ')}`, sub: a.lead?.full_name || '', at: a.created_at,
  }))
  ;((signins as any).data || []).forEach((s: any) => events.push({
    type: 'signin', icon: 'signin', title: `Class sign-in`, sub: s.student_name || '', at: s.signed_in_at,
  }))
  ;((attendance as any).data || []).forEach((a: any) => events.push({
    type: 'attendance', icon: 'attendance', title: `${a.staff?.full_name || 'Staff'} clocked in`, sub: a.status === 'late' ? 'Late' : 'On time', at: a.clock_in_at,
  }))
  events.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())

  return NextResponse.json({ events: events.slice(0, 20) })
}
