import { NextRequest, NextResponse } from 'next/server'
import { intakeLead } from '@/lib/leadIntake'

export const runtime = 'nodejs'

/**
 * LinkedIn Lead Gen Forms webhook. Field shape varies by integration, so we
 * handle the common ones.
 */
export async function POST(req: NextRequest) {
  const body = await req.json()

  const fields: Record<string, string> = {}
  for (const a of body.answers || []) {
    const key = (a.questionId || a.question || '').toLowerCase()
    fields[key] = a.answer?.string || a.answerDetails?.textAnswer || ''
  }

  const name = body.firstName && body.lastName
    ? `${body.firstName} ${body.lastName}`
    : fields.full_name || fields.name || ''

  const { leadId, duplicate } = await intakeLead({
    full_name: name,
    email: body.email || fields.email || null,
    phone: body.phone || fields.phone_number || fields.phone || null,
    source: 'linkedin',
    course_interest: fields.course || fields.program || null,
    utm_source: 'linkedin',
    raw_payload: body,
  })

  return NextResponse.json({ success: true, lead_id: leadId, duplicate })
}
