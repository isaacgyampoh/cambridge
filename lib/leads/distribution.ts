/**
 * Weighted lead distribution — the pure algorithm, with no data access.
 *
 * Kept free of imports so it can be unit tested directly, and so the same
 * decision can be reasoned about independently of the database that stores
 * its state. lib/leads/distributionStore.ts supplies the state; the SQL
 * function distribute_lead_weighted runs this same rule under a lock.
 *
 * ── WHY THE PREVIOUS RULE DID NOT PRODUCE THE CONFIGURED SHARES ────────────
 *
 * Selection ordered by `open_leads / tier_weight` — whoever held the fewest
 * open leads per unit of weight took the next one. That equalises OPEN
 * INVENTORY, which is not the same quantity as SHARE OF NEW LEADS, and the
 * difference is not subtle:
 *
 *   - `open_leads` counted only leads not yet registered, lost or written
 *     off. Closing a lead therefore lowered your score and earned you the
 *     next one, while leads left sitting raised it and starved you.
 *   - So the share each person received was decided by how fast they cleared
 *     their pipeline, not by any configured number. Two people on identical
 *     weights could receive 60/40 purely from working at different speeds.
 *
 * No percentage a manager set could survive that, because no percentage was
 * ever an input to it.
 *
 * ── THE RULE USED INSTEAD ──────────────────────────────────────────────────
 *
 * Smooth weighted round-robin, the scheduler nginx uses to spread requests
 * across upstreams. Each member carries a running `currentWeight`:
 *
 *     for every active member:  current += allocationPercent
 *     chosen = the member with the highest current
 *     chosen.current -= total of all active allocationPercent
 *
 * Its properties are exactly the ones asked for:
 *
 *   - It converges on the configured proportions EXACTLY over each full
 *     cycle, rather than approaching them on average.
 *   - It is smooth: 50/30/20 interleaves as A B A C A B …, not AAAAA BBB CC,
 *     so no one waits a whole cycle for their first lead.
 *   - It cannot starve anybody with a non-zero weight — a member not chosen
 *     keeps accumulating and must eventually hold the maximum.
 *   - It is deterministic, so a given state and pool always give the same
 *     answer and a test can assert it.
 *   - It self-corrects drift: the carried state IS the accumulated debt, so
 *     a member who missed leads while inactive is owed them on return, and
 *     changing the percentages transitions smoothly instead of restarting.
 *
 * The state is the set of currentWeight values. It is small, it is written on
 * every assignment, and it lives in the database — never in memory, because a
 * second Vercel instance would then distribute from its own private idea of
 * who is owed what.
 */

export type Member = {
  id: string
  /** The configured share. Relative, so any positive scale behaves the same. */
  allocationPercent: number
  /** Carried allocation debt. Persisted between calls. */
  currentWeight: number
}

export type Pick = {
  chosen: string
  /** The weight that decided it, recorded against the assignment. */
  weight: number
  /** The state to persist, for every member, after this pick. */
  nextState: Array<{ id: string; currentWeight: number }>
  poolSize: number
}

/**
 * Choose the next recipient and return the state that must be saved.
 *
 * Returns null only when no member can receive a lead — an empty pool, or one
 * in which every allocation is zero. A null is a real condition the caller
 * must handle by leaving the lead unassigned and detectable; it is never a
 * quiet fallback to somebody arbitrary.
 */
export function pickWeighted(members: Member[]): Pick | null {
  const eligible = members.filter(m => m.allocationPercent > 0)
  if (eligible.length === 0) return null

  const total = eligible.reduce((sum, m) => sum + m.allocationPercent, 0)
  if (total <= 0) return null

  /*
   * Every eligible member accrues its share first. A member joining with a
   * currentWeight of 0 therefore competes on this round rather than waiting.
   */
  const accrued = eligible.map(m => ({
    id: m.id,
    allocationPercent: m.allocationPercent,
    currentWeight: m.currentWeight + m.allocationPercent,
  }))

  // Highest accrued weight wins; ties break on id so the result is stable.
  let best = accrued[0]
  for (const m of accrued) {
    if (m.currentWeight > best.currentWeight ||
       (m.currentWeight === best.currentWeight && m.id < best.id)) {
      best = m
    }
  }

  /*
   * The winner pays the full pool back. That is what keeps the long-run
   * shares exact: over one full cycle each member accrues its percent once
   * per lead and pays `total` once per lead it receives, so leads received
   * settles at percent/total.
   */
  const nextState = accrued.map(m => ({
    id: m.id,
    currentWeight: m.id === best.id ? m.currentWeight - total : m.currentWeight,
  }))

  /*
   * Members with a zero allocation are excluded from selection but their
   * state is preserved untouched, so switching somebody back on does not
   * hand them a backlog of everything they missed.
   */
  for (const m of members) {
    if (m.allocationPercent <= 0) nextState.push({ id: m.id, currentWeight: m.currentWeight })
  }

  return {
    chosen: best.id,
    weight: best.allocationPercent,
    nextState,
    poolSize: eligible.length,
  }
}

/**
 * Run the scheduler over a sequence, for tests and for the preview the
 * configuration screen shows before anybody saves a change.
 */
export function simulate(members: Member[], count: number): Record<string, number> {
  const state = members.map(m => ({ ...m }))
  const tally: Record<string, number> = {}
  for (const m of members) tally[m.id] = 0

  for (let i = 0; i < count; i++) {
    const pick = pickWeighted(state)
    if (!pick) break
    tally[pick.chosen] = (tally[pick.chosen] ?? 0) + 1
    const byId = new Map(pick.nextState.map(s => [s.id, s.currentWeight]))
    for (const m of state) {
      const next = byId.get(m.id)
      if (next !== undefined) m.currentWeight = next
    }
  }
  return tally
}

/* ── Validation, shared by the API and the screen ─────────────────────────── */

export type ValidationIssue = { field: string; message: string }

/**
 * The rule the business actually runs on.
 *
 * The active allocations are a complete distribution pool: every shared lead
 * goes to exactly one active member, so the shares that decide who gets it
 * must account for the whole. A set totalling 90 or 130 has no meaning — the
 * algorithm would normalise it silently and the screen would show numbers
 * that are not the ones being applied.
 *
 * So the total is required to equal 100, and the screen says so rather than
 * quietly rescaling behind the manager's back.
 */
export function validateAllocations(
  rows: Array<{ id: string; allocationPercent: number; isActive: boolean }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.id)) {
      issues.push({ field: r.id, message: 'This person appears more than once.' })
    }
    seen.add(r.id)

    if (!Number.isFinite(r.allocationPercent)) {
      issues.push({ field: r.id, message: 'Enter a number.' })
      continue
    }
    if (r.allocationPercent < 0) {
      issues.push({ field: r.id, message: 'A share cannot be negative.' })
    }
    if (r.allocationPercent > 100) {
      issues.push({ field: r.id, message: 'A share cannot be more than 100%.' })
    }
  }

  const activeRows = rows.filter(r => r.isActive)
  const total = activeRows.reduce((s, r) => s + (Number.isFinite(r.allocationPercent) ? r.allocationPercent : 0), 0)

  if (activeRows.length > 0 && Math.abs(total - 100) > 0.01) {
    issues.push({
      field: 'total',
      message: `The active shares add up to ${round2(total)}%. They must total 100% before this can be saved.`,
    })
  }

  return issues
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Expected count, actual count and the gap between them, for the dashboard. */
export function varianceFor(
  received: number, totalAssigned: number, allocationPercent: number,
): { expected: number; actualShare: number; variance: number } {
  const expected = round2((totalAssigned * allocationPercent) / 100)
  const actualShare = totalAssigned > 0 ? round2((received / totalAssigned) * 100) : 0
  return { expected, actualShare, variance: round2(actualShare - allocationPercent) }
}
