import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyStudent, STUDENT_COOKIE } from '@/lib/student/auth'
import { lookup } from '@/lib/db/lookup'

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

  const { row: doc, failed: docFailed } = await lookup(sb.from('documents')
    .select('id, name, file_url, unlock_after_amount, course_id, type, section_no').eq('id', id).maybeSingle())

  // "Not found" is a statement about the file. A read that failed is a
  // statement about us, and the student should be told to try again rather
  // than that their material does not exist.
  if (docFailed) {
    console.error('[portal/material] could not read the document:', docFailed)
    return new NextResponse('We could not load that just now. Please try again in a moment.', { status: 503 })
  }
  if (!doc?.file_url || doc.type !== 'course_material') {
    return new NextResponse('Not found', { status: 404 })
  }

  // Every rule is checked here, on the server. Nothing in the browser can be
  // altered to reveal a locked file.
  const { row: fee, failed: feeFailed } = await lookup(sb.from('student_fees')
    .select('amount_paid, total_fee, course_id').eq('lead_id', s.leadId).maybeSingle())

  /*
   * "No enrolment found" to somebody who has paid for one is the worst
   * sentence this route can produce, and a failed read produced it. The gate
   * still fails CLOSED — no material is released — but it says which of the
   * two things went wrong.
   */
  if (feeFailed) {
    console.error('[portal/material] could not read the fee record:', feeFailed)
    return new NextResponse('We could not check your enrolment just now. Please try again in a moment.', { status: 503 })
  }
  if (!fee) return new NextResponse('No enrolment found.', { status: 403 })

  const paid = Number(fee.amount_paid || 0)
  const total = Number(fee.total_fee || 0)
  const fullyPaid = total > 0 ? paid >= total : paid > 0
  const needed = Number(doc.unlock_after_amount || 0)

  // 1) Their course
  if (doc.course_id && doc.course_id !== fee.course_id) {
    return new NextResponse('This material is not part of your course.', { status: 403 })
  }

  // 2) Enrolment still active
  const { data: enr } = await sb.from('class_enrollments')
    .select('batch_id, status').eq('lead_id', s.leadId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (enr && ['cancelled', 'withdrawn'].includes(String(enr.status || ''))) {
    return new NextResponse('Your enrolment is not active. Please contact the administration.', { status: 403 })
  }

  // 3) Paid enough for this material
  if (paid < needed) {
    return new NextResponse('This material opens once your payments reach the required amount.', { status: 403 })
  }

  // 4) The class has reached its section — unless they have paid in full,
  //    which opens everything.
  if (!fullyPaid && doc.section_no) {
    let reached = 1
    if (enr?.batch_id) {
      const { data: b } = await sb.from('batches')
        .select('current_section').eq('id', enr.batch_id).maybeSingle()
      reached = Number((b as any)?.current_section || 1)
    }
    if (Number(doc.section_no) > reached) {
      return new NextResponse('This material opens when your class reaches that section.', { status: 403 })
    }
  }

  // Read it server-side and stream it through. A private file has no public
  // address at all, so there is nothing for anyone to share or save.
  if (String(doc.file_url).startsWith('materials://')) {
    const path = String(doc.file_url).replace('materials://', '')
    const { data, error } = await sb.storage.from('materials').download(path)
    if (error || !data) return new NextResponse('Could not load the file', { status: 502 })
    return new NextResponse(data.stream() as any, {
      headers: {
        'Content-Type': data.type || 'application/pdf',
        'Content-Disposition': `inline; filename="${doc.name.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
  // Everything above returns, so this branch is the only one that reaches
  // here: the declaration belongs with the assignment rather than being
  // hoisted above a block that never falls through to it.
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
