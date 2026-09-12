import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { chatbotOpening, buildLeadContext } from '@/lib/chatbot'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'
import { eligibleMarketers, isEligible } from '@/lib/leads/eligibility'
import { lookup } from '@/lib/db/lookup'

/**
 * Assign a lead to a marketer.
 *
 * Two things were wrong before, and between them they account for the report
 * that some staff receive leads while others never do:
 *
 *  1. The candidate pool was every active non-super-admin profile — trainers,
 *     accountants, receptionists, students. Leads were assigned to people with
 *     no leads page, which looks exactly like a lead vanishing. Eligibility is
 *     now decided by lib/leads/eligibility.ts, from the same portal rules the
 *     navigation and route guard use.
 *
 *  2. Selection was `Math.random()` over tier-weighted tickets, despite the
 *     docblock claiming round robin. A support-tier marketer holding nineteen
 *     open leads had one ticket against a high performer's forty-five, so on a
 *     quiet day they could receive nothing at all. Selection is now weighted
 *     least-loaded inside a locked database function: deterministic, still
 *     tier-weighted, and incapable of starving anyone.
 *
 * Assignment is also now separated from onboarding. The AI opening message and
 * WhatsApp welcome used to be awaited inside this call, which put an external
 * API on the critical path of every inbound lead — a slow provider delayed
 * assignment and a serverless timeout could abandon it half-done. Onboarding
 * runs after the assignment is committed and can fail harmlessly.
 */
export async function autoAssignLead(
  leadId: string,
  preferredMarketerId?: string | null,
  source?: string | null
): Promise<string | null> {
  const sb = createServiceClient()

  // A personal referral or flyer link names its owner. Honour it, but only if
  // that person is genuinely eligible — otherwise fall through to the pool
  // rather than parking the lead somewhere it will never be seen.
  if (preferredMarketerId && await isEligible(preferredMarketerId)) {
    const { data: claimed } = await sb.rpc('assign_lead_to', {
      p_lead_id: leadId,
      p_marketer: preferredMarketerId,
      p_actor: null,
      p_reason: 'referral_link',
      p_source: source || null,
      p_force: false,          // never steal a lead that is already owned
    })
    if (claimed) {
      await onLeadAssigned(leadId, preferredMarketerId)
      return preferredMarketerId
    }
    /*
     * Not claimed → it already had an owner. Report that owner.
     *
     * ── AND STOP IF WE CANNOT READ WHO ──────────────────────────────────
     *
     * The claim above ran with p_force: false precisely so a lead that is
     * already owned is never stolen. Reaching here means it IS owned. If this
     * read then fails, `lead?.assigned_to` is undefined and execution used to
     * carry on into the weighted lottery below — which is the one code path
     * that exists to give a lead to somebody new.
     *
     * So a database blip could take a lead off the marketer who already had
     * it, and the only trace would be an assignment that looked ordinary.
     * That is somebody's commission.
     *
     * Returning null says "not assigned by me", which every caller already
     * handles: the lead keeps the owner it has, and nothing is announced to
     * anybody who has not earned it.
     */
    const { row: lead, failed } = await lookup(
      sb.from('leads').select('assigned_to').eq('id', leadId).maybeSingle(),
    )
    if (failed) {
      console.error('[autoAssign] lead', leadId, 'is already owned but the owner could not be read:', failed)
      return null
    }
    if (lead?.assigned_to) return lead.assigned_to
  }

  // Respect the master toggle. Defaults ON when the setting is absent.
  try {
    const { data: setting } = await sb.from('settings')
      .select('value').eq('key', 'auto_assign_leads').maybeSingle()
    if (setting && setting.value === 'false') return null
  } catch { /* no settings table yet — default ON */ }

  const candidates = await eligibleMarketers({ source })
  if (!candidates.length) {
    console.warn('[autoAssign] no eligible marketer for lead', leadId,
      '— nobody active has the my_leads portal')
    return null
  }

  // The database picks and claims in one locked step.
  const { data: chosen, error } = await sb.rpc('assign_lead_atomic', {
    p_lead_id: leadId,
    p_candidates: candidates.map(c => c.id),
    p_weights: candidates.map(c => c.weight),
    p_actor: null,
    p_reason: 'auto',
    p_source: source || null,
    p_force: false,
  })

  if (error) {
    console.error('[autoAssign] assign_lead_atomic failed:', error.message)
    return null
  }
  if (!chosen) return null

  await onLeadAssigned(leadId, chosen as string)
  return chosen as string
}

/**
 * Everything that should happen once a lead has an owner.
 *
 * Deliberately best-effort throughout: the assignment is already committed, so
 * nothing in here may throw its way back out. A failed WhatsApp message must
 * never cost us the lead.
 */
export async function onLeadAssigned(leadId: string, marketerId: string): Promise<void> {
  const sb = createServiceClient()

  try {
    const [{ data: lead }, { data: marketer }] = await Promise.all([
      sb.from('leads').select('full_name, source, phone, course_interest, status').eq('id', leadId).maybeSingle(),
      sb.from('profiles').select('full_name').eq('id', marketerId).maybeSingle(),
    ])

    // In-app notification.
    await sb.from('notifications').insert({
      user_id: marketerId,
      type: 'lead',
      title: 'New lead assigned to you',
      body: `${lead?.full_name || 'A new lead'} (${lead?.source || 'system'}) was assigned to you. Reach out soon.`,
      link: `/marketer/leads/${leadId}`,
    }).then(() => {}, () => {})

    // Pending-SMS counter, incremented atomically. A cron sends ONE
    // consolidated text per marketer, so twenty leads is one message.
    await sb.rpc('bump_lead_pending', { p_marketer: marketerId }).then(() => {}, () => {})

    // Never start a sales conversation with someone already converted or
    // written off — the opening asks what they do for work, which is wrong
    // for a paid student.
    const skip = ['registered', 'not_interested', 'lost']
    if (skip.includes(String(lead?.status || ''))) return

    // Nurture sequence enrolment.
    try {
      const { data: seqs } = await sb.from('sequences')
        .select('id').eq('is_active', true).eq('trigger', 'new_lead').limit(1)
      if (seqs?.[0]) {
        const { data: steps } = await sb.from('sequence_steps')
          .select('delay_hours').eq('sequence_id', seqs[0].id)
          .order('step_order', { ascending: true }).limit(1)
        const firstDelay = steps?.[0]?.delay_hours ?? 24
        await sb.from('sequence_enrollments').upsert({
          sequence_id: seqs[0].id, lead_id: leadId,
          current_step: 0,
          next_run_at: new Date(Date.now() + firstDelay * 3600000).toISOString(),
          status: 'active',
        }, { onConflict: 'sequence_id,lead_id' })
      }
    } catch { /* sequences are optional */ }

    // Opening conversation through the marketer's own WhatsApp line.
    if (lead?.phone) {
      try {
        const { sendWelcomePack } = await import('@/lib/leadWelcome')
        const pack = await sendWelcomePack({
          leadId, phone: lead.phone,
          leadName: lead.full_name, courseInterest: lead.course_interest,
          marketerId, marketerName: marketer?.full_name,
        })
        if (pack.sent) return          // the welcome pack IS the opening
      } catch (e) { console.error('[onLeadAssigned] welcome pack:', e) }

      /*
       * The opening now introduces the centre and its assistant, and says a
       * colleague is there whenever they want one. It used to open in the
       * assigned marketer's voice — "Hi, this is Kwame from Cambridge" — for a
       * message no Kwame had written or seen.
       *
       * The marketer's name is still passed, but only so a handover can name
       * who is picking it up.
       */
      const ctx = await buildLeadContext({ lead: { ...lead, id: leadId, assigned_to: marketerId } })
      const opened = await chatbotOpening(ctx)
      const opening = opened?.text || null
      if (opening && await sendWhatsAppText(lead.phone, opening, marketerId)) {
        await sb.from('ai_conversations').insert({
          lead_id: leadId,
          phone: String(lead.phone).replace(/[^0-9]/g, '').replace(/^0/, '233'),
          marketer_id: marketerId,
          incoming_text: null, reply_text: opening, answered_by: 'ai_opening',
        }).then(() => {}, () => {})
      }
    }
  } catch (e) {
    console.error('[onLeadAssigned] failed for lead', leadId, e)
  }
}
