import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { onNewLead } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const sb = createServiceClient()

  // LinkedIn sends leads in various formats depending on integration
  const answers = body.answers || []
  const fields: Record<string, string> = {}
  for (const a of answers) {
    const key = (a.questionId || a.question || '').toLowerCase()
    fields[key] = a.answer?.string || a.answerDetails?.textAnswer || ''
  }

  const name = body.firstName && body.lastName
    ? `${body.firstName} ${body.lastName}`
    : fields.full_name || fields.name || 'LinkedIn Lead'

  const { data: lead, error } = await sb.from('leads').insert({
    full_name: name,
    email: body.email || fields.email || null,
    phone: body.phone || fields.phone_number || null,
    source: 'linkedin',
    status: 'new',
    course_interest: fields.course || fields.program || null,
    utm_source: 'linkedin',
    raw_payload: body,
  }).select().single()

  if (error) {
    console.error('[LinkedIn Webhook]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await onNewLead(lead)
  return NextResponse.json({ success: true, lead_id: lead.id })
}
