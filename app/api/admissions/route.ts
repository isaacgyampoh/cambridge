import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { sendSMS, SMS } from '@/lib/integrations/sms'
import { sendWhatsAppText, WA } from '@/lib/integrations/whatsapp'
import { lookup, unavailable, saveFailed } from '@/lib/db/lookup'
import { runQuietly } from '@/lib/quiet'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session = token ? await verifySession(token) : { valid: false, role: '' }
  if (!session.valid || !['super_admin', 'project_manager', 'admissions_officer'].includes(session.role || '')) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }
  const { leadId } = await req.json()
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 })

  const sb = createServiceClient()

  // maybeSingle, not single: single() reports "no rows" as an error, which
  // would make a genuinely missing lead indistinguishable from a failed read.
  const { row: lead, failed } = await lookup(
    sb.from('leads').select('*, course:course_interest').eq('id', leadId).maybeSingle(),
  )
  if (failed) return unavailable('[admissions]', failed, 'that lead')
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Create admission record
  const { data: admission, error } = await sb.from('admissions').insert({
    lead_id: leadId,
    status: 'pending',
    notes: `Lead "${lead.full_name}" marked as ready to join.`,
  }).select().single()

  if (error) {
    console.error('[Admissions] Insert error:', error)
    return saveFailed('[admissions]', error.message, 'that admission')
  }

  // Get all admissions officers and accountants
  const { data: officers } = await sb.from('profiles')
    .select('*')
    .in('role', ['admissions_officer', 'accountant'])
    .eq('is_active', true)

  const notifications = []
  const smsTasks = []

  for (const officer of officers || []) {
    // In-app notification
    notifications.push({
      user_id: officer.id,
      type: 'admission',
      title: officer.role === 'accountant' ? 'New student awaiting payment' : 'New admission case',
      body: `${lead.full_name} is ready to join${lead.course_interest ? ` (${lead.course_interest})` : ''}. Please process their admission.`,
      data: { lead_id: leadId, admission_id: admission.id },
    })

    // SMS
    if (officer.phone) {
      if (officer.role === 'admissions_officer') {
        smsTasks.push(sendSMS(officer.phone, SMS.readyToJoinToOfficer(officer.full_name, lead.full_name)))
      } else {
        smsTasks.push(sendSMS(officer.phone, SMS.readyToJoinToAccountant(lead.full_name)))
      }
    }
  }

  /*
   * The admission row is already committed above. Everything from here is
   * notification, and NONE of it may fail the request.
   *
   * It used to be one Promise.all over the notification insert and every
   * officer's SMS. A single unreachable number rejected the whole thing, the
   * route threw, and the caller was told the admission had failed — while the
   * row sat in the database. The obvious response to that error is to press
   * the button again, which is how one lead ends up with two admissions.
   *
   * allSettled, and each failure is logged by name so a silently broken
   * number is findable.
   */
  const sideEffects: Promise<unknown>[] = [...smsTasks]
  // An empty insert is not a no-op worth sending; skip it when nobody is on duty.
  if (notifications.length > 0) {
    sideEffects.unshift(Promise.resolve(sb.from('notifications').insert(notifications)))
  } else {
    console.warn('[Admissions] no active admissions officer or accountant to notify for lead', leadId)
  }

  if (lead.phone) {
    sideEffects.push(sendWhatsAppText(lead.phone, WA.applicationConfirmed(
      lead.full_name,
      lead.course_interest || 'your chosen program'
    )))
  }

  const notified = await runQuietly(`[Admissions] lead ${leadId}`, sideEffects)
  if (notified.failed > 0) {
    console.warn('[Admissions] admission', admission.id, 'created;',
      notified.failed, 'of', notified.total, 'notifications did not go out')
  }

  // Schedule auto-send if officer doesn't act in 20 mins
  // (Handled by a cron job checking admissions where offer_letter_sent_at IS NULL and created_at < NOW() - INTERVAL '20 minutes')

  return NextResponse.json({ success: true, admission })
}
