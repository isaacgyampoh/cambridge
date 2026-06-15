import { createServiceClient } from '@/lib/supabase/server'

/**
 * Round-robin auto-assignment for system-generated leads (Facebook,
 * website, etc). Distributes evenly by giving the new lead to the active
 * marketer who currently has the FEWEST open leads — so the workload
 * stays balanced. Returns the assigned marketer id, or null if none.
 *
 * Controlled by the 'auto_assign_leads' setting (defaults ON). When off,
 * leads stay unassigned for a PM to distribute manually.
 */
export async function autoAssignLead(leadId: string): Promise<string | null> {
  const sb = createServiceClient()

  // Respect the toggle (defaults ON if the setting/table isn't present)
  try {
    const { data: setting } = await sb.from('settings')
      .select('value').eq('key', 'auto_assign_leads').maybeSingle()
    if (setting && setting.value === 'false') return null
  } catch { /* no settings table yet — default ON */ }

  // Active marketers
  const { data: marketers } = await sb.from('profiles')
    .select('id, full_name')
    .eq('role', 'marketing_officer').eq('is_active', true)
  if (!marketers || marketers.length === 0) return null

  // Count each marketer's current OPEN leads (not closed/registered/lost)
  const { data: openLeads } = await sb.from('leads')
    .select('assigned_to')
    .not('assigned_to', 'is', null)
    .not('status', 'in', '(registered,lost,not_interested)')

  const load: Record<string, number> = {}
  marketers.forEach(m => { load[m.id] = 0 })
  ;(openLeads || []).forEach((l: any) => {
    if (l.assigned_to in load) load[l.assigned_to]++
  })

  // Pick the marketer with the fewest open leads (ties -> first)
  let chosen = marketers[0]
  let min = load[chosen.id] ?? 0
  for (const m of marketers) {
    if ((load[m.id] ?? 0) < min) { chosen = m; min = load[m.id] ?? 0 }
  }

  // Assign
  await sb.from('leads').update({
    assigned_to: chosen.id,
    assigned_at: new Date().toISOString(),
  }).eq('id', leadId)

  // Notify the marketer
  const { data: lead } = await sb.from('leads').select('full_name, source').eq('id', leadId).maybeSingle()
  await sb.from('notifications').insert({
    user_id: chosen.id, type: 'lead',
    title: 'New lead assigned to you',
    body: `${lead?.full_name || 'A new lead'} (${lead?.source || 'system'}) was assigned to you. Reach out soon.`,
    link: `/marketer/leads/${leadId}`,
  })

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

  return chosen.id
}
