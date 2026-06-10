import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWelcomeEmail } from '@/lib/integrations/email'

export async function POST(req: NextRequest) {
  const { applicationId } = await req.json()
  if (!applicationId) return NextResponse.json({ error: 'Missing applicationId' }, { status: 400 })

  const sb = createServiceClient()
  const { data: app } = await sb.from('applications').select('*, course:course_id(name)').eq('id', applicationId).single()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

  // Send welcome email
  if (app.email) {
    await sendWelcomeEmail(app.email, app.full_name, (app as any).course?.name || 'your program')
  }

  // Create or link lead
  let leadId = app.lead_id
  if (!leadId) {
    const { data: lead } = await sb.from('leads').insert({
      full_name: app.full_name,
      email: app.email,
      phone: app.phone,
      source: app.marketer_id ? 'referral' : 'website',
      status: 'ready_to_join',
      course_interest: (app as any).course?.name || null,
    }).select().single()
    leadId = lead?.id
    if (leadId) await sb.from('applications').update({ lead_id: leadId }).eq('id', applicationId)
  }

  // Trigger admission flow
  if (leadId) {
    const { data: lead } = await sb.from('leads').select('*').eq('id', leadId).single()
    if (lead && lead.status !== 'ready_to_join') {
      await sb.from('leads').update({ status: 'ready_to_join' }).eq('id', leadId)
    }
    // Create admission
    const { data: admission } = await sb.from('admissions').insert({
      lead_id: leadId,
      course_id: app.course_id,
      status: 'pending',
    }).select().single()

    if (admission) {
      await sb.from('applications').update({ admission_id: admission.id }).eq('id', applicationId)
    }
  }

  return NextResponse.json({ success: true })
}
