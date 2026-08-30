import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, clientIp, retryMessage } from '@/lib/auth/rateLimit'
import { parseClassMode } from '@/lib/classMode'
import { recordAudit } from '@/lib/audit'
import { z } from 'zod'

export const runtime = 'nodejs'

/**
 * Public application submission.
 *
 * Uses the service role because the applicant is not signed in, so a browser
 * insert is correctly blocked by row-level security.
 *
 * THE CLASS MODE DEFECT ORIGINATED HERE. The old line was:
 *
 *     delivery: body.delivery || 'online',
 *
 * — an unvalidated client field with a default of ONLINE, while every other
 * module in the system defaults to IN_PERSON. An applicant registering for a
 * physical class whose form did not send the field became a virtual record at
 * the moment of creation, and every downstream document was then correctly
 * generated for the wrong mode.
 *
 * There is now no default. The class mode is required, normalised through the
 * canonical parser, and rejected if absent or unrecognised — because guessing
 * it is the bug.
 */

const Body = z.object({
  full_name: z.string().trim().min(2, 'Please enter your full name').max(200),
  phone: z.string().trim().min(7, 'Please enter your phone number').max(30),
  course_id: z.string().uuid('Please choose a programme'),

  // Required. No default, deliberately.
  delivery: z.string().min(1, 'Please choose whether this is an online or in-person class'),

  email: z.string().trim().email('That email address does not look right').max(200).optional().nullable(),
  first_name: z.string().trim().max(100).optional().nullable(),
  middle_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().max(100).optional().nullable(),
  gender: z.string().trim().max(30).optional().nullable(),
  date_of_birth: z.string().trim().max(40).optional().nullable(),
  country_of_birth: z.string().trim().max(100).optional().nullable(),
  nationality: z.string().trim().max(100).optional().nullable(),
  postal_address: z.string().trim().max(300).optional().nullable(),
  residential_address: z.string().trim().max(300).optional().nullable(),
  last_school: z.string().trim().max(200).optional().nullable(),
  certification_attained: z.string().trim().max(200).optional().nullable(),
  course_of_study: z.string().trim().max(200).optional().nullable(),
  year_completed: z.string().trim().max(20).optional().nullable(),
  batch_preference: z.string().trim().max(200).optional().nullable(),
  payment_method: z.enum(['online', 'cash']).optional().default('online'),
  marketer_id: z.string().uuid().optional().nullable(),
  marketer_code: z.string().trim().max(60).optional().nullable(),
  utm_source: z.string().trim().max(200).optional().nullable(),
  utm_medium: z.string().trim().max(200).optional().nullable(),
  utm_campaign: z.string().trim().max(200).optional().nullable(),
  utm_content: z.string().trim().max(200).optional().nullable(),
  landing_source: z.string().trim().max(200).optional().nullable(),
})

export async function POST(req: NextRequest) {
  // This endpoint is public and writes with the service role, so it is a
  // natural target for automated submission. Limited per IP.
  const limit = await rateLimit(`apply:${clientIp(req)}`, 12, 60 * 60, 60 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `We have received several applications from this connection. ${retryMessage(limit.retryAfter)}` },
      { status: 429 }
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Please check the form and try again.' },
      { status: 400 }
    )
  }
  const body = parsed.data

  // Normalise to the canonical vocabulary. Anything unrecognised is refused
  // rather than defaulted.
  const classMode = parseClassMode(body.delivery)
  if (!classMode) {
    return NextResponse.json(
      { error: 'Please choose whether you are registering for the online or the in-person class.' },
      { status: 400 }
    )
  }

  const sb = createServiceClient()

  // Attribution is resolved server-side from the link code. It must never
  // depend on a browser-side profiles read — RLS blocks that for visitors,
  // which is why link leads used to arrive unassigned.
  let marketerId = body.marketer_id || null
  if (!marketerId && body.marketer_code) {
    const { data: m } = await sb.from('profiles')
      .select('id, is_active').eq('marketer_code', body.marketer_code).maybeSingle()
    if (m && m.is_active !== false) marketerId = m.id
  }

  // Confirm the programme exists before writing anything against it.
  const { data: course } = await sb.from('courses')
    .select('id, is_active').eq('id', body.course_id).maybeSingle()
  if (!course || course.is_active === false) {
    return NextResponse.json({ error: 'That programme is not open for registration.' }, { status: 400 })
  }

  const { data: app, error } = await sb.from('applications').insert({
    marketer_id: marketerId,
    full_name: body.full_name,
    first_name: body.first_name || null,
    middle_name: body.middle_name || null,
    last_name: body.last_name || null,
    email: body.email || null,
    phone: body.phone,
    gender: body.gender || null,
    date_of_birth: body.date_of_birth || null,
    country_of_birth: body.country_of_birth || null,
    nationality: body.nationality || null,
    postal_address: body.postal_address || null,
    residential_address: body.residential_address || null,
    address: body.residential_address || null,
    last_school: body.last_school || null,
    certification_attained: body.certification_attained || null,
    course_of_study: body.course_of_study || null,
    year_completed: body.year_completed || null,
    course_id: body.course_id,
    batch_preference: body.batch_preference || null,
    delivery: classMode,                    // canonical, validated, never guessed
    payment_method: body.payment_method,
    payment_status: 'pending',
    utm_source: body.utm_source || null,
    utm_medium: body.utm_medium || null,
    utm_campaign: body.utm_campaign || null,
    utm_content: body.utm_content || null,
    landing_source: body.landing_source || null,
  }).select('id').single()

  if (error) {
    console.error('[applications/submit] insert failed:', error.message)
    return NextResponse.json(
      { error: 'We could not save your application. Please try again.' },
      { status: 500 }
    )
  }

  // Cash payment means there is no online payment step to wait for.
  if (body.payment_method === 'cash') {
    await sb.from('applications').update({
      is_submitted: true, submitted_at: new Date().toISOString(),
    }).eq('id', app.id)
  }

  await recordAudit({
    action: 'application.submitted', resource: 'applications', resourceId: app.id,
    success: true, metadata: { classMode, courseId: body.course_id, marketerId }, request: req,
  })

  return NextResponse.json({ success: true, id: app.id })
}
