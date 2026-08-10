import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyStudent, STUDENT_COOKIE } from '@/lib/student/auth'

export const runtime = 'nodejs'

/**
 * Serve a course material through the portal instead of handing out its link.
 * The file's real address is never given to the browser, so it cannot be
 * copied, forwarded or sold on. Access is re-checked on every view, so a
 * student who stops paying loses it.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await verifyStudent(req.cookies.get(STUDENT_COOKIE)?.value)
  if (!s) return new NextResponse('Not signed in', { status: 401 })

  const { id } = await ctx.params
  const sb = createServiceClient()

  const { data: doc } = await sb.from('documents')
    .select('id, name, file_url, unlock_after_amount, course_id, type').eq('id', id).maybeSingle()
  if (!doc?.file_url || doc.type !== 'course_material') {
    return new NextResponse('Not found', { status: 404 })
  }

  // Have they paid enough for this one?
  const { data: fee } = await sb.from('student_fees')
    .select('amount_paid, course_id').eq('lead_id', s.leadId).maybeSingle()
  const paid = Number(fee?.amount_paid || 0)
  const needed = Number(doc.unlock_after_amount || 0)
  const rightCourse = !doc.course_id || doc.course_id === fee?.course_id

  if (!rightCourse || paid < needed) {
    return new NextResponse('This material is locked until your payments reach the required amount.', { status: 403 })
  }

  // Stream it through, so the real file address never reaches the browser.
  const upstream = await fetch(doc.file_url)
  if (!upstream.ok) return new NextResponse('Could not load the file', { status: 502 })

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/pdf',
      // View in place; never offer a download dialog.
      'Content-Disposition': `inline; filename="${doc.name.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
