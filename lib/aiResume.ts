import { createServiceClient } from '@/lib/supabase/server'

/**
 * Decide when the assistant may speak again after a human took over.
 *
 * A marketer never tells us "I'm done", so we infer it: if they have not
 * replied for a while AND the lead is now waiting on an answer, the handover
 * has gone quiet and the assistant resumes so the lead is not left hanging.
 * A marketer can also resume it by hand at any time from the lead page.
 */
const QUIET_HOURS = 6

export async function maybeResumeAI(leadId: string): Promise<boolean> {
  const sb = createServiceClient()
  const { data: lead } = await sb.from('leads')
    .select('id, ai_paused, ai_paused_by, last_human_at, needs_human').eq('id', leadId).maybeSingle()
  if (!lead?.ai_paused) return true            // already active

  // A handoff for missing history or an explicit request for help stays with
  // the human until they resume it themselves — resuming blind would repeat
  // the original problem.
  if (lead.ai_paused_by !== 'human') return false

  const since = lead.last_human_at ? Date.now() - new Date(lead.last_human_at).getTime() : Infinity
  if (since < QUIET_HOURS * 3600000) return false

  await sb.from('leads').update({
    ai_paused: false, needs_human: false, ai_paused_by: null,
  }).eq('id', leadId).then(() => {}, () => {})
  return true
}
