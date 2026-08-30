/**
 * Lead selection — the pure decision logic, with no data access.
 *
 * Kept free of imports so it can be unit tested directly and reasoned about on
 * its own. lib/leads/eligibility.ts supplies the data; this decides.
 */

/** Tier weights. A high performer receives proportionally more leads. */
export const TIER_WEIGHT: Record<string, number> = {
  high: 45, mid: 35, low: 20, support: 20,
}

export const DEFAULT_TIER = 'mid'

export function weightForTier(tier?: string | null): number {
  return TIER_WEIGHT[tier || DEFAULT_TIER] ?? TIER_WEIGHT[DEFAULT_TIER]
}

/**
 * Choose the next recipient: weighted least-loaded.
 *
 * Whoever has the lowest `openLeads / tierWeight` wins. Over a run that
 * converges on the tier proportions, and — unlike the `Math.random()` lottery
 * this replaces — it cannot starve anyone: a marketer holding no leads always
 * scores zero, the minimum possible, so they take the next lead.
 *
 * Ties break on the longest wait since a previous assignment, then on id, so
 * the outcome is deterministic and reproducible in a test. The same ordering
 * is implemented in assign_lead_atomic, which is where it runs under a lock.
 */
export function pickRecipient(
  candidates: Array<{ id: string; weight: number }>,
  load: Record<string, number>,
  lastAssignedAt: Record<string, number> = {}
): string | null {
  if (!candidates.length) return null

  let best: { id: string; score: number; last: number } | null = null

  for (const c of candidates) {
    const weight = c.weight > 0 ? c.weight : 1
    const score = (load[c.id] ?? 0) / weight
    const last = lastAssignedAt[c.id] ?? 0

    if (
      best === null ||
      score < best.score ||
      (score === best.score && last < best.last) ||
      (score === best.score && last === best.last && c.id < best.id)
    ) {
      best = { id: c.id, score, last }
    }
  }

  return best?.id ?? null
}
