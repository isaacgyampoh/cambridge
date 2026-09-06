import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { parseClassMode, type ClassMode } from '@/lib/classMode'

/**
 * The authoritative class mode for a lead.
 *
 * People register more than once. In production, one lead had:
 *
 *     4 Aug   in_person   payment pending   (abandoned)
 *    10 Aug   online      payment PAID      (the real one)
 *
 * Any code that asks for "the application for this lead" without preferring
 * the paid one can pick the abandoned row, and then a student enrolled online
 * is sent the physical admission letter. That is the reported bug, and it
 * needs no template mix-up to explain it: the template selection was correct,
 * the class mode handed to it was wrong.
 *
 * The ordering here matches class_mode_for_lead() in migration 0010 exactly,
 * so SQL and application code cannot drift:
 *
 *   1. the paid application  — money settles intent
 *   2. then a submitted one
 *   3. then the most recent
 *
 * Returns null when there is nothing to go on. Never guesses: guessing is what
 * caused the original defect.
 */
export async function classModeForLead(leadId: string): Promise<ClassMode | null> {
  if (!leadId) return null

  const sb = createServiceClient()
  const { data, error } = await sb.from('applications')
    .select('delivery, payment_status, is_submitted, submitted_at, created_at')
    .eq('lead_id', leadId)
    .in('delivery', ['online', 'in_person'])

  if (error) {
    console.error('[classModeForLead] lookup failed:', error.message)
    return null
  }
  if (!data?.length) return null

  type Row = {
    delivery: string; payment_status: string | null; is_submitted: boolean | null
    submitted_at: string | null; created_at: string
  }

  const when = (r: Row) => new Date(r.submitted_at || r.created_at).getTime()

  const best = (data as Row[]).slice().sort((a, b) => {
    const paid = Number(b.payment_status === 'paid') - Number(a.payment_status === 'paid')
    if (paid) return paid
    const submitted = Number(Boolean(b.is_submitted)) - Number(Boolean(a.is_submitted))
    if (submitted) return submitted
    return when(b) - when(a)
  })[0]

  return parseClassMode(best.delivery)
}
