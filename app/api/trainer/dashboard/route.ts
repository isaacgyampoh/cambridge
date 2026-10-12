import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: any = token ? await verifySession(token) : { valid: false }
  if (!session.valid) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const me = session.userId

  const { data: batches } = await sb.from('batches').select('id, name, status, start_date, courses(name)').eq('trainer_id', me).limit(200)
  const all = batches || []
  const ongoing = all.filter((b: any) => b.status === 'ongoing')
  const upcoming = all.filter((b: any) => b.status === 'upcoming')

  // Count students across the trainer's batches
  let totalStudents = 0
  const ids = all.map((b: any) => b.id)
  if (ids.length) {
    /*
     * class_enrollments, not batch_students. Nothing writes batch_students —
     * no insert anywhere in the codebase, no seed, no trigger — so this count
     * was always 0 and read as "no students", which is indistinguishable from
     * a class nobody has joined. class_enrollments is the roster that is
     * actually written, by /api/classes/enroll and by manual registration.
     */
    const { count } = await sb.from('class_enrollments')
      .select('id', { count: 'exact', head: true })
      .in('batch_id', ids).eq('status', 'active')
    totalStudents = count || 0
  }

  return NextResponse.json({
    totalClasses: all.length,
    ongoing: ongoing.length,
    upcoming: upcoming.length,
    totalStudents,
    classes: all.slice(0, 8).map((b: any) => ({ id: b.id, name: b.name, status: b.status, course: b.courses?.name || '', start: b.start_date })),
  })
}
