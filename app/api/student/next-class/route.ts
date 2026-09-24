import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { unavailable } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * The student's next class — date, time, and where to be.
 *
 * ── WHY THIS IS A ROUTE AND NOT A TABLE THE STUDENT CAN READ ───────────────
 *
 * The obvious move is to add class_sessions to the student's readable tables
 * and query it from the page. That would be a mistake. /api/data scopes rows
 * by an owner column, and class_sessions has none for a student — so a
 * student would read EVERY batch's sessions, including `class_code`, which is
 * the code the attendance sign-in accepts. Anybody could then sign in to a
 * class they are not in.
 *
 * So the query runs here, scoped to the batches this student is actually
 * enrolled on, and returns only the fields a student needs. The class code
 * never leaves the server.
 */

type NextClass = {
  course: string | null
  batch: string | null
  date: string
  schedule: string | null
  venue: string | null
  zoomLink: string | null
  mode: string | null
  /** 'session' when a session is scheduled, 'start' when it is the start date. */
  basis: 'session' | 'start'
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: { valid?: boolean; userId?: string } = token ? await verifySession(token) : { valid: false }
  if (!s.valid) return NextResponse.json({ error: 'Please sign in to continue.' }, { status: 401 })

  const sb = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  // Only this student's batches. Nothing here is taken from the request.
  const { data: mine, error: mineError } = await sb.from('batch_students')
    .select('batch_id').eq('student_id', s.userId as string)
  if (mineError) return unavailable('[student/next-class]', mineError.message, 'your classes')

  const batchIds = (mine || []).map(r => r.batch_id as string)
  if (!batchIds.length) return NextResponse.json({ next: null, reason: 'not_enrolled' })

  const { data: batches, error: batchError } = await sb.from('batches')
    .select('id, name, start_date, schedule, venue, zoom_link, class_type, courses(name)')
    .in('id', batchIds)
  if (batchError) return unavailable('[student/next-class]', batchError.message, 'your classes')

  const byId = new Map((batches || []).map(b => [b.id as string, b]))
  const detail = (b: Record<string, unknown> | undefined) => ({
    course: ((b?.courses as { name?: string } | null)?.name) ?? null,
    batch: (b?.name as string) ?? null,
    schedule: (b?.schedule as string) ?? null,
    venue: (b?.venue as string) ?? null,
    zoomLink: (b?.zoom_link as string) ?? null,
    mode: (b?.class_type as string) ?? null,
  })

  /*
   * A scheduled session is the better answer, so it is preferred. Only the
   * date is taken from it — never class_code, and never the sign-in state.
   */
  const { data: sessions, error: sessionError } = await sb.from('class_sessions')
    .select('batch_id, session_date')
    .in('batch_id', batchIds)
    .gte('session_date', today)
    .order('session_date', { ascending: true })
    .limit(1)
  if (sessionError) return unavailable('[student/next-class]', sessionError.message, 'your class schedule')

  if (sessions?.length) {
    const row = sessions[0]
    const next: NextClass = {
      ...detail(byId.get(row.batch_id as string) as Record<string, unknown> | undefined),
      date: row.session_date as string,
      basis: 'session',
    }
    return NextResponse.json({ next })
  }

  /*
   * No session scheduled yet. A start date in the future is still a true
   * answer to "when do I next turn up"; a start date in the past is not, and
   * is left alone rather than dressed up as a next class.
   */
  const upcoming = (batches || [])
    .filter(b => b.start_date && String(b.start_date) >= today)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0]

  if (upcoming) {
    const next: NextClass = {
      ...detail(upcoming as Record<string, unknown>),
      date: upcoming.start_date as string,
      basis: 'start',
    }
    return NextResponse.json({ next })
  }

  return NextResponse.json({ next: null, reason: 'nothing_scheduled' })
}
