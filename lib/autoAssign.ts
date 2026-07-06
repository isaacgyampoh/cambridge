import { createServiceClient } from '@/lib/supabase/server'
import { generateOpeningMessage } from '@/lib/integrations/ai-assistant'
import { sendWhatsAppText } from '@/lib/integrations/whatsapp'

/**
 * Round-robin auto-assignment for system-generated leads (Facebook,
 * website, etc). Distributes evenly by giving the new lead to the active
 * marketer who currently has the FEWEST open leads — so the workload
 * stays balanced. Returns the assigned marketer id, or null if none.
 *
 * Controlled by the 'auto_assign_leads' setting (defaults ON). When off,
 * leads stay unassigned for a PM to distribute manually.
 */
export async function autoAssignLead(leadId: string, preferredMarketerId?: string | null): Promise<string | null> {
  const sb = createServiceClient()

  // If a specific marketer owns this lead (e.g. their personal referral/flyer
  // link), assign straight to them — skip round-robin — but still fire the AI
  // opening + nurture below.
  if (preferredMarketerId) {
    const { data: pref } = await sb.from('profiles')
      .select('id, is_active').eq('id', preferredMarketerId).maybeSingle()
    if (pref?.is_active) {
      await sb.from('leads').update({ assigned_to: preferredMarketerId, assigned_at: new Date().toISOString() }).eq('id', leadId)
      await fireLeadOnboarding(sb, leadId, preferredMarketerId)
      return preferredMarketerId
    }
    // if the preferred marketer is invalid/inactive, fall through to round-robin
  }

  // Respect the toggle (defaults ON if the setting/table isn't present)
  try {
    const { data: setting } = await sb.from('settings')
      .select('value').eq('key', 'auto_assign_leads').maybeSingle()
    if (setting && setting.value === 'false') return null
  } catch { /* no settings table yet — default ON */ }

  // Everyone except the super admin is in the marketing pool — all active
  // staff get leads to work on, not just marketing officers. A person can
  // opt out by setting in_lead_pool = false on their profile.
  const { data: marketers } = await sb.from('profiles')
    .select('id, full_name, in_lead_pool, performance_tier')
    .neq('role', 'super_admin').eq('is_active', true)
  const pool = (marketers || []).filter(m => m.in_lead_pool !== false)
  if (pool.length === 0) return null

  // Count each person's current OPEN leads (for tie-breaking within a tier)
  const { data: openLeads } = await sb.from('leads')
    .select('assigned_to')
    .not('assigned_to', 'is', null)
    .not('status', 'in', '(registered,lost,not_interested)')

  const load: Record<string, number> = {}
  pool.forEach(m => { load[m.id] = 0 })
  ;(openLeads || []).forEach((l: any) => {
    if (l.assigned_to in load) load[l.assigned_to]++
  })

  // ── Weighted-by-tier lottery ──
  // high=4, mid=3, low=2, support=1. A high performer is 4x as likely as
  // support to receive any given lead (≈40/30/20/10 across tiers over time).
  const TIER_WEIGHT: Record<string, number> = { high: 4, mid: 3, low: 2, support: 1 }
  const weightOf = (m: any) => TIER_WEIGHT[m.performance_tier as string] ?? 3  // default mid

  // Build a weighted pool, then pick proportionally. To also keep things fair
  // for people who are behind, we lightly favour the less-loaded person within
  // the same weight by using weight / (1 + openLeads) as the effective ticket.
  const tickets = pool.map(m => ({ m, ticket: weightOf(m) / (1 + (load[m.id] ?? 0)) }))
  const totalTickets = tickets.reduce((sum, t) => sum + t.ticket, 0)

  let chosen = pool[0]
  if (totalTickets > 0) {
    let r = Math.random() * totalTickets
    for (const t of tickets) {
      r -= t.ticket
      if (r <= 0) { chosen = t.m; break }
    }
  }

  // Assign
  await sb.from('leads').update({
    assigned_to: chosen.id,
    assigned_at: new Date().toISOString(),
  }).eq('id', leadId)

  await fireLeadOnboarding(sb, leadId, chosen.id)
  return chosen.id
}

/**
 * After a lead is assigned to a marketer (round-robin OR a specific marketer),
 * notify the marketer, enroll in the new-lead nurture sequence, and fire the
 * AI WhatsApp opening message through that marketer's line.
 */
async function fireLeadOnboarding(sb: any, leadId: string, marketerId: string) {
  const { data: marketer } = await sb.from('profiles').select('full_name').eq('id', marketerId).maybeSingle()

  // Notify the marketer in-app
  const { data: lead } = await sb.from('leads').select('full_name, source').eq('id', leadId).maybeSingle()
  await sb.from('notifications').insert({
    user_id: marketerId, type: 'lead',
    title: 'New lead assigned to you',
    body: `${lead?.full_name || 'A new lead'} (${lead?.source || 'system'}) was assigned to you. Reach out soon.`,
    link: `/marketer/leads/${leadId}`,
  }).then(() => {}, () => {})

  // Increment the pending-SMS counter (a cron sends ONE consolidated SMS per
  // marketer, so 20 leads = 1 text, not 20). Never blocks assignment.
  try {
    const { data: p } = await sb.from('lead_assign_pending').select('pending').eq('marketer_id', marketerId).maybeSingle()
    if (p) {
      await sb.from('lead_assign_pending').update({ pending: (p.pending || 0) + 1, last_lead_at: new Date().toISOString() }).eq('marketer_id', marketerId)
    } else {
      await sb.from('lead_assign_pending').insert({ marketer_id: marketerId, pending: 1, last_lead_at: new Date().toISOString() })
    }
  } catch { /* table optional */ }

  // Auto-enroll into any active "new lead" nurture sequence
  try {
    const { data: seqs } = await sb.from('sequences')
      .select('id').eq('is_active', true).eq('trigger', 'new_lead').limit(1)
    if (seqs && seqs[0]) {
      const { data: steps } = await sb.from('sequence_steps')
        .select('delay_hours').eq('sequence_id', seqs[0].id).order('step_order', { ascending: true }).limit(1)
      const firstDelay = steps?.[0]?.delay_hours ?? 24
      await sb.from('sequence_enrollments').upsert({
        sequence_id: seqs[0].id, lead_id: leadId,
        current_step: 0, next_run_at: new Date(Date.now() + firstDelay * 3600000).toISOString(),
        status: 'active',
      }, { onConflict: 'sequence_id,lead_id' })
    }
  } catch { /* sequences optional */ }

  // AI auto-conversation: start the WhatsApp chat through the marketer's line.
  try {
    const { data: full } = await sb.from('leads')
      .select('full_name, phone, course_interest').eq('id', leadId).maybeSingle()
    if (full?.phone) {
      const opening = await generateOpeningMessage({
        leadName: full.full_name,
        marketerName: marketer?.full_name || 'Cambridge',
        courseInterest: full.course_interest,
      })
      if (opening) {
        const sent = await sendWhatsAppText(full.phone, opening, marketerId)
        if (sent) {
          await sb.from('ai_conversations').insert({
            lead_id: leadId, phone: full.phone, marketer_id: marketerId,
            incoming_text: null, reply_text: opening, answered_by: 'ai_opening',
          }).then(() => {}, () => {})
        }
      }
    }
  } catch { /* AI opening optional — never block assignment */ }
}
