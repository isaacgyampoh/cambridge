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
  mode: z.enum(['assign', 'claim', 'reassign']).optional().default('assign'),
  /** Why a lead was taken off one person and given to another. */
  note: z.string().trim().max(400).optional(),
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
  const { leadId, marketerId, mode, note } = parsed.data

  // Assigning to somebody with no leads portal is how leads used to disappear.
  if (!await isEligible(marketerId)) {
    return NextResponse.json(
      { error: 'That person cannot receive leads. Give them the Leads access first, or choose someone else.' },
      { status: 400 }
    )
  }

  const sb = createServiceClient()

  /*
   * Who holds it now, read BEFORE the write.
   *
   * This decides whether the history row says 'manual' or 'reassign', and it
   * is what the activity note names. assign_lead_to records from_marketer
   * itself and is the authority on what actually changed — this is only the
   * label, so a stale read here cannot misattribute the lead, only the word
   * describing the move.
   */
  const { data: priorRow } = await sb.from('leads')
    .select('assigned_to').eq('id', leadId).maybeSingle()
  const prior = (priorRow?.assigned_to as string | null) || null
  const isReassignment = !!prior && prior !== marketerId

  const { data: changed, error } = await sb.rpc('assign_lead_to', {
    p_lead_id: leadId,
    p_marketer: marketerId,
    p_actor: session.userId,
    p_reason: mode === 'claim' ? 'claim' : isReassignment ? 'reassign' : 'manual',
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

  /*
   * Who did it, recorded on the lead itself.
   *
   * assign_lead_to writes the actor into lead_assignments but not into
   * leads.assigned_by, and the admin lead list reads that column to show
   * "assigned by". The two callers that used to set it did so with a raw
   * PATCH sent BEFORE this route — which is exactly what broke assignment
   * notifications, because the PATCH left the lead already belonging to the
   * marketer and assign_lead_to then returned false. Setting it here means no
   * caller needs to write the leads table itself.
   */
  await sb.from('leads')
    .update({ assigned_by: session.userId })
    .eq('id', leadId)
    .then(({ error }) => {
      if (error) console.error('[leads/assign] could not record assigned_by:', error.message)
    })

  const [{ data: lead }, { data: marketer }] = await Promise.all([
    sb.from('leads').select('full_name, phone, course_interest').eq('id', leadId).maybeSingle(),
    sb.from('profiles').select('full_name, phone, wa_intro').eq('id', marketerId).maybeSingle(),
  ])

  await recordAudit({
    actorId: session.userId,
    action: mode === 'claim' ? 'lead.claimed'
      : isReassignment ? 'lead.reassigned' : 'lead.assigned',
    resource: 'leads',
    resourceId: leadId,
    success: true,
    // `from` is what makes a reassignment answerable later: this lead was
    // taken off somebody, and the record says off whom, by whom and why.
    metadata: { to: marketerId, from: prior, reason: note || null },
    request: req,
  })

  /*
   * A reassignment also lands on the lead's own timeline, because the people
   * who need it — the marketer who lost the lead and the one who gained it —
   * read the lead, not the audit log.
   *
   * Best effort: the assignment is committed and a missing note must not
   * undo it or fail the response.
   */
  if (isReassignment) {
    const [{ data: fromWho }, { data: actor }] = await Promise.all([
      sb.from('profiles').select('full_name').eq('id', prior).maybeSingle(),
      sb.from('profiles').select('full_name').eq('id', session.userId).maybeSingle(),
    ])
    await sb.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'note',
      subject: 'Lead reassigned',
      description:
        `Moved from ${fromWho?.full_name || 'a colleague'} to ${marketer?.full_name || 'another colleague'}`
        + ` by ${actor?.full_name || 'a manager'}.`
        + (note ? ` Reason: ${note}` : ''),
      created_by: session.userId,
    }).then(({ error }) => {
      if (error) console.error('[leads/assign] could not record the reassignment note:', error.message)
    })
  }

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
        WA.leadAssigned(lead.full_name, marketer?.full_name || '', lead.course_interest),
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
