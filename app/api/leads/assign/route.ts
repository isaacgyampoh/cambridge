import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { isEligible } from '@/lib/leads/eligibility'
import { onLeadAssigned } from '@/lib/autoAssign'
import { recordAudit } from '@/lib/audit'
import { queueSMS } from '@/lib/notifications/sms'
import { sendWhatsAppText, WA } from '@/lib/integrations/whatsapp'
import { SMS } from '@/lib/integrations/sms'
import { z } from 'zod'

export const runtime = 'nodejs'

const Body = z.object({
  leadId: z.string().uuid('That lead reference is not valid.'),
  marketerId: z.string().uuid('Choose a marketer to assign to.'),
  /** A claim only succeeds on an unassigned lead; a reassign takes it over. */
  mode: z.enum(['assign', 'claim']).optional().default('assign'),
})

/**
 * Manually assign or reassign a lead.
 *
 * The write goes through assign_lead_to, which locks the lead row, so two
 * people pressing Assign at the same moment cannot both believe they won —
 * exactly one call returns true and records the change.
 */
export const POST = withGuard({ portals: ['leads', 'pm_leads'] }, async (req: NextRequest, { session }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request.' }, { status: 400 })
  }
  const { leadId, marketerId, mode } = parsed.data

  // Assigning to somebody with no leads portal is how leads used to disappear.
  if (!await isEligible(marketerId)) {
    return NextResponse.json(
      { error: 'That person cannot receive leads. Give them the Leads access first, or choose someone else.' },
      { status: 400 }
    )
  }

  const sb = createServiceClient()

  const { data: changed, error } = await sb.rpc('assign_lead_to', {
    p_lead_id: leadId,
    p_marketer: marketerId,
    p_actor: session.userId,
    p_reason: mode === 'claim' ? 'claim' : 'manual',
    p_source: null,
    p_force: mode !== 'claim',
  })

  if (error) {
    console.error('[leads/assign] assign_lead_to failed:', error.message)
    return NextResponse.json({ error: 'Could not assign that lead. Please try again.' }, { status: 500 })
  }

  if (!changed) {
    // Either it was claimed first, or it already belonged to this person.
    const { data: lead } = await sb.from('leads')
      .select('assigned_to, profiles:assigned_to(full_name)').eq('id', leadId).maybeSingle()
    const holder = lead?.assigned_to === marketerId
      ? 'that marketer already'
      : (lead as { profiles?: { full_name?: string } } | null)?.profiles?.full_name || 'someone else'
    return NextResponse.json(
      { error: `This lead belongs to ${holder}. Refresh to see who has it.`, alreadyAssigned: true },
      { status: 409 }
    )
  }

  const [{ data: lead }, { data: marketer }] = await Promise.all([
    sb.from('leads').select('full_name, phone, course_interest').eq('id', leadId).maybeSingle(),
    sb.from('profiles').select('full_name, phone, wa_intro').eq('id', marketerId).maybeSingle(),
  ])

  await recordAudit({
    actorId: session.userId,
    action: mode === 'claim' ? 'lead.claimed' : 'lead.assigned',
    resource: 'leads',
    resourceId: leadId,
    success: true,
    metadata: { to: marketerId },
    request: req,
  })

  // Notifications are queued, not awaited on the response path: the assignment
  // is already committed and a slow SMS provider must not delay the UI or risk
  // a timeout that leaves the operator unsure whether it worked.
  if (marketer?.phone && lead?.full_name) {
    await queueSMS({
      to: marketer.phone,
      message: SMS.leadAssignedToMarketer(marketer.full_name || '', lead.full_name),
      kind: 'lead_assigned',
      entityId: leadId,
      dedupeKey: `lead_assigned:${leadId}:${marketerId}`,
    })
  }

  if (lead?.phone) {
    try {
      await sendWhatsAppText(
        lead.phone,
        WA.leadAssigned(lead.full_name, marketer?.full_name || '', lead.course_interest, marketer?.wa_intro),
        marketerId,
      )
    } catch { /* the lead is assigned regardless */ }
  }

  await sb.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'assignment',
    subject: mode === 'claim' ? 'Lead claimed' : 'Lead assigned',
    description: `Assigned to ${marketer?.full_name || 'a marketer'}.`,
    created_by: session.userId,
  }).then(() => {}, () => {})

  await onLeadAssigned(leadId, marketerId)

  return NextResponse.json({ success: true })
})
