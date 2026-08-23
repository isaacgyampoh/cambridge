import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { findBrochure } from '@/lib/courseMatch'

export const runtime = 'nodejs'
const ALLOWED = ['super_admin', 'administrator', 'project_manager']

/** What each course would actually send, so a mismatch is visible at a glance. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const s: any = token ? await verifySession(token) : { valid: false }
  if (!s.valid || !ALLOWED.includes(s.role)) return NextResponse.json({ error: 'unauth' }, { status: 401 })

  const sb = createServiceClient()
  const { data: courses } = await sb.from('courses')
    .select('id, name, code').eq('is_active', true).order('name').limit(100)

  const { data: brochures } = await sb.from('documents')
    .select('id, name, course_id, file_url').eq('type', 'brochure').eq('is_active', true).limit(100)

  const nameOf = (id: string | null) =>
    id ? (courses || []).find((c: any) => c.id === id)?.name || 'unknown course' : null

  const rows: any[] = []
  for (const co of courses || []) {
    const url = await findBrochure(co.id)
    const doc = (brochures || []).find((b: any) => b.file_url === url)
    rows.push({
      course: co.name,
      code: co.code,
      willSend: doc?.name || (url ? 'a file' : null),
      tiedToCourse: doc ? nameOf(doc.course_id) : null,
      ok: !!url,
    })
  }

  const unassigned = (brochures || []).filter((b: any) => !b.course_id).map((b: any) => b.name)
  const missing = rows.filter(r => !r.ok).map(r => r.course)

  return NextResponse.json({
    courses: rows,
    brochuresNotTiedToACourse: unassigned,
    coursesWithNoBrochure: missing,
    advice: missing.length
      ? `These courses have no brochure: ${missing.join(', ')}. Upload one for each and pick the course.`
      : unassigned.length
        ? `These brochures are not tied to a course: ${unassigned.join(', ')}. Edit each one and select its course.`
        : 'Every course sends its own brochure.',
  })
}
