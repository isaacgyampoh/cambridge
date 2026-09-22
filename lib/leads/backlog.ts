import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { eligibleMarketers } from '@/lib/leads/eligibility'
import { distributeLead } from '@/lib/leads/distributionStore'
import { notifyImportBatch } from '@/lib/leads/importNotify'

/**
 * ASSIGN EVERY LEAD THAT IS STILL WAITING FOR AN OWNER.
 *
 * Used by "Distribute unassigned" on the Leads screen and by the scheduled
 * sweep. The same rules as a lead arriving live:
 *
 *   1. A lead that names somebody — referrer_id, set by a personal marketing
 *      or referral link — goes to that person if they can hold a lead.
 *   2. Everything else goes through the configured percentages.
 *
 * ── WHY THIS IS NOT autoAssignLead IN A LOOP ───────────────────────────────
 *
 * That is what the button used to do, and it had three faults. It announced
 * each lead separately, so a marketer given forty waiting leads received
 * forty texts and forty emails. It ran every assignment one after another
 * inside a single request, so a large backlog ran into the function time
 * limit and stopped part-way with no record of where. And it discarded the
 * read of the unassigned leads, so a database failure reported "no
 * unassigned leads".
 *
 * Here each person is told once, the run stops cleanly before the limit and
 * reports how many are left, and a failed read is a failure.
 */

export type BacklogResult =
  | {
      ok: true
      total: number
      assigned: number
      failed: number
      remaining: number
      byPerson: Array<{ name: string; count: number }>
      reasons: string[]
      skipped?: string
    }
  | { ok: false; reason: string }

export async function assignBacklog(opts: {
  /** The scheduled sweep honours the Settings switch; a person pressing the button does not. */
  respectToggle: boolean
  /** Leave anything newer than this to the live path, which is already handling it. */
  minAgeMinutes?: number
  /** Stop before the platform stops us. */
  budgetMs?: number
  limit?: number
}): Promise<BacklogResult> {
  const started = Date.now()
  const budget = opts.budgetMs ?? 45_000
  const sb = createServiceClient()

  if (opts.respectToggle) {
    const { data: setting } = await sb.from('settings')
      .select('value').eq('key', 'auto_assign_leads').maybeSingle()
    if (setting?.value === 'false') {
      return { ok: true, total: 0, assigned: 0, failed: 0, remaining: 0, byPerson: [], reasons: [],
        skipped: 'Automatic distribution is switched off in Settings.' }
    }
  }

  let query = sb.from('leads')
    .select('id, source, referrer_id, created_at')
    .is('assigned_to', null)
    .order('created_at', { ascending: true })   // longest-waiting first
    .limit(opts.limit ?? 500)
  if (opts.minAgeMinutes) {
    query = query.lte('created_at', new Date(Date.now() - opts.minAgeMinutes * 60_000).toISOString())
  }

  const { data: leads, error } = await query
  // Not "there are no unassigned leads".
  if (error) return { ok: false, reason: `The unassigned leads could not be read: ${error.message}` }
  if (!leads?.length) {
    return { ok: true, total: 0, assigned: 0, failed: 0, remaining: 0, byPerson: [], reasons: [] }
  }

  let candidates
  try {
    candidates = await eligibleMarketers()
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The staff list could not be read.' }
  }
  if (!candidates.length) {
    return { ok: false, reason: 'Nobody can currently receive leads. Give at least one active member of staff the Leads access.' }
  }
  const eligible = new Set(candidates.map(c => c.id))

  const tally = new Map<string, number>()
  const reasons = new Set<string>()
  let assigned = 0, failed = 0, processed = 0

  for (const lead of leads) {
    if (Date.now() - started > budget) break
    processed++

    let owner: string | null = null

    // 1. Explicit attribution is preserved.
    if (lead.referrer_id && eligible.has(lead.referrer_id as string)) {
      const { data: claimed, error: claimError } = await sb.rpc('assign_lead_to', {
        p_lead_id: lead.id, p_marketer: lead.referrer_id, p_actor: null,
        p_reason: 'referral_link', p_source: (lead.source as string) || null, p_force: false,
      })
      if (claimError) reasons.add(claimError.message)
      else if (claimed) owner = lead.referrer_id as string
    }

    // 2. Everything else follows the configured percentages.
    if (!owner) {
      const outcome = await distributeLead(lead.id as string, candidates, { source: (lead.source as string) || null })
      if (outcome.failure) reasons.add(outcome.failure)
      else owner = outcome.chosen
    }

    if (owner) {
      assigned++
      tally.set(owner, (tally.get(owner) || 0) + 1)
    } else {
      failed++
    }
  }

  // Each person is told once, about all of theirs.
  if (tally.size) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    await notifyImportBatch(tally, `backlog-${stamp}`, 'backlog')
  }

  const names = new Map(candidates.map(c => [c.id, c.fullName]))
  return {
    ok: true,
    total: leads.length,
    assigned,
    failed,
    remaining: leads.length - processed,
    byPerson: [...tally.entries()]
      .map(([id, count]) => ({ name: names.get(id) || 'Unknown', count }))
      .sort((a, b) => b.count - a.count),
    reasons: [...reasons].slice(0, 5),
  }
}
