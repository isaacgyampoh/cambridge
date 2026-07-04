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
    .select('id, full_name, in_lead_pool')
    .neq('role', 'super_admin').eq('is_active', true)
  const pool = (marketers || []).filter(m => m.in_lead_pool !== false)
  if (pool.length === 0) return null

  // Count each marketer's current OPEN leads (not closed/registered/lost)
  const { data: openLeads } = await sb.from('leads')
    .select('assigned_to')
    .not('assigned_to', 'is', null)
    .not('status', 'in', '(registered,lost,not_interested)')

  const load: Record<string, number> = {}
  pool.forEach(m => { load[m.id] = 0 })
  ;(openLeads || []).forEach((l: any) => {
    if (l.assigned_to in load) load[l.assigned_to]++
  })

  // Pick the marketer with the fewest open leads (ties -> first)
  let chosen = pool[0]
  let min = load[chosen.id] ?? 0
  for (const m of pool) {
    if ((load[m.id] ?? 0) < min) { chosen = m; min = load[m.id] ?? 0 }
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

  // Notify the marketer
  const { data: lead } = await sb.from('leads').select('full_name, source').eq('id', leadId).maybeSingle()
  await sb.from('notifications').insert({
    user_id: marketerId, type: 'lead',
    title: 'New lead assigned to you',
    body: `${lead?.full_name || 'A new lead'} (${lead?.source || 'system'}) was assigned to you. Reach out soon.`,
    link: `/marketer/leads/${leadId}`,
  }).then(() => {}, () => {})

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
