import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import type { Candidate } from '@/lib/leads/eligibility'
import { pickWeighted, type Member } from '@/lib/leads/distribution'

/**
 * WHERE THE LEAD DISTRIBUTION CONFIGURATION AND ITS SCHEDULER STATE LIVE.
 *
 * ── WHY IT IS NOT A TABLE OF ITS OWN ───────────────────────────────────────
 *
 * It was. Migration 0021 creates lead_distribution_members and a plpgsql
 * function to pick under a lock, and that is a better shape for this. But
 * migrations on this project are applied by hand against a database this code
 * cannot reach, 0021 had not been run, and the consequence was not a degraded
 * feature — it was the one the operator actually saw:
 *
 *     "We could not save the lead distribution settings."
 *
 * Every save failed, because the upsert targeted a table that did not exist.
 * A feature that cannot be configured is not a feature, and "run this SQL
 * first" is not a fix.
 *
 * So the configuration lives in `settings` — the key/value table this
 * application already reads and already writes through /api/data, which is
 * how the auto-assign switch on the Settings screen is stored. One row, one
 * JSON document, no new schema, and it works on the database as it is today.
 *
 * ── HOW CONCURRENCY IS HANDLED WITHOUT A LOCK ──────────────────────────────
 *
 * A row cannot be locked through PostgREST, so this uses the other standard
 * answer: compare-and-swap. The document carries a version; a write updates
 * the row only where the stored value is still exactly the one that was read.
 * PostgREST reports how many rows that matched, so a write that matched none
 * lost the race and is retried against fresh state.
 *
 * That gives the same guarantee the lock was for — two leads arriving
 * together cannot both allocate from the same stale snapshot — and it holds
 * across Vercel instances, because the contended state is the row, not
 * anything in this process.
 */

const KEY = 'lead_distribution'

/** How many allocation decisions are kept for the History view. */
const EVENT_LIMIT = 300

/** How many times a losing compare-and-swap is retried before giving up. */
const CAS_ATTEMPTS = 6

export type MemberState = {
  percent: number
  active: boolean
  /** Smooth weighted round-robin carry. */
  current: number
  received: number
  lastAt: string | null
}

export type AllocationEvent = {
  leadId: string
  staffId: string
  weight: number | null
  method: string
  at: string
  source: string | null
}

export type DistributionDoc = {
  version: number
  members: Record<string, MemberState>
  events: AllocationEvent[]
  updatedAt: string | null
  updatedBy: string | null
}

const EMPTY: DistributionDoc = {
  version: 0, members: {}, events: [], updatedAt: null, updatedBy: null,
}

function parseDoc(raw: string | null | undefined): DistributionDoc {
  if (!raw) return { ...EMPTY }
  try {
    const parsed = JSON.parse(raw) as Partial<DistributionDoc>
    return {
      version: Number(parsed.version) || 0,
      members: parsed.members && typeof parsed.members === 'object' ? parsed.members : {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
      updatedAt: parsed.updatedAt ?? null,
      updatedBy: parsed.updatedBy ?? null,
    }
  } catch {
    /*
     * Unreadable rather than absent. Returning a blank document here would
     * silently discard everybody's configured shares and start distributing
     * equally, so this is reported to the caller instead.
     */
    throw new Error('The lead distribution settings are stored in a form this version cannot read.')
  }
}

type ReadResult = { doc: DistributionDoc; raw: string | null }

async function readDoc(): Promise<ReadResult> {
  const sb = createServiceClient()
  const { data, error } = await sb.from('settings')
    .select('value').eq('key', KEY).maybeSingle()

  // A failed read is not an empty configuration.
  if (error) throw new Error(error.message)

  const raw = (data?.value as string | null) ?? null
  return { doc: parseDoc(raw), raw }
}

/**
 * Write the document back, but only if nobody else changed it first.
 *
 * Returns false when the compare-and-swap matched no row, which means another
 * request won the race and the caller should re-read and try again.
 */
async function writeDoc(next: DistributionDoc, expectedRaw: string | null): Promise<boolean> {
  const sb = createServiceClient()
  const payload = JSON.stringify({ ...next, version: next.version + 1 })

  if (expectedRaw === null) {
    /*
     * No row yet. onConflict makes a second request creating it at the same
     * moment update rather than fail on the unique key — and because the
     * update is unconditional in that case, the loser simply re-reads on the
     * next allocation. The first write establishes the row; correctness from
     * then on is the compare-and-swap below.
     */
    const { error } = await sb.from('settings')
      .upsert({ key: KEY, value: payload }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    return true
  }

  const { data, error } = await sb.from('settings')
    .update({ value: payload })
    .eq('key', KEY)
    .eq('value', expectedRaw)     // ← the compare
    .select('key')

  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0  // ← the swap happened only if a row matched
}

/* ── Reading the configuration for the screen ─────────────────────────────── */

export type MemberRow = {
  profileId: string
  fullName: string
  role: string
  allocationPercent: number
  isActive: boolean
  currentWeight: number
  leadsReceived: number
  lastAssignedAt: string | null
  configured: boolean
}

export type ConfigReadResult =
  | { ok: true; members: MemberRow[]; events: AllocationEvent[] }
  | { ok: false; reason: string }

/**
 * Everybody who may receive a lead, with their configured share.
 *
 * Built from the eligible pool rather than from the stored document, so
 * somebody who becomes eligible appears on the screen at zero rather than
 * being invisible until a manager thinks to add them.
 */
export async function readDistributionConfig(candidates: Candidate[]): Promise<ConfigReadResult> {
  let doc: DistributionDoc
  try {
    ({ doc } = await readDoc())
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }

  const members: MemberRow[] = candidates.map(c => {
    const m = doc.members[c.id]
    return {
      profileId: c.id,
      fullName: c.fullName,
      role: c.role,
      allocationPercent: m ? Number(m.percent) || 0 : 0,
      isActive: m ? m.active !== false : true,
      currentWeight: m ? Number(m.current) || 0 : 0,
      leadsReceived: m ? Number(m.received) || 0 : 0,
      lastAssignedAt: m?.lastAt ?? null,
      configured: !!m,
    }
  })

  return { ok: true, members, events: doc.events }
}

export type SaveRow = { profileId: string; allocationPercent: number; isActive: boolean }

/**
 * Persist the configured shares.
 *
 * The scheduler carry (`current`) is deliberately preserved. Resetting it on
 * every save would throw away the accumulated debt and hand whoever happens to
 * be first in the next cycle a burst — the "huge temporary bias" that makes a
 * percentage change look broken.
 */
export async function saveDistributionConfig(
  rows: SaveRow[], actorId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    let doc: DistributionDoc, raw: string | null
    try {
      ({ doc, raw } = await readDoc())
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }

    const members = { ...doc.members }
    for (const r of rows) {
      const existing = members[r.profileId]
      members[r.profileId] = {
        percent: r.allocationPercent,
        active: r.isActive,
        current: existing ? Number(existing.current) || 0 : 0,
        received: existing ? Number(existing.received) || 0 : 0,
        lastAt: existing?.lastAt ?? null,
      }
    }

    try {
      const won = await writeDoc({
        ...doc, members,
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      }, raw)
      if (won) return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }

  return {
    ok: false,
    reason: 'Somebody else was changing the allocation at the same time. Please try again.',
  }
}

/* ── Allocating a lead ────────────────────────────────────────────────────── */

export type DistributionOutcome = {
  chosen: string | null
  weight: number | null
  poolSize: number | null
  method: string | null
  failure: string | null
}

/**
 * Choose and claim an owner for a lead, weighted by the configured shares.
 *
 * The decision is made against compare-and-swapped state; the claim itself
 * goes through assign_lead_to, which locks the lead row — so a lead can still
 * only be claimed once even if two requests choose the same moment.
 */
export async function distributeLead(
  leadId: string,
  candidates: Candidate[],
  opts: { source?: string | null } = {},
): Promise<DistributionOutcome> {
  const sb = createServiceClient()
  const none = { chosen: null, weight: null, poolSize: null, method: null }

  if (!candidates.length) {
    return { ...none, failure: 'Nobody is eligible to receive a lead.' }
  }

  /*
   * An owned lead is left alone, and — importantly — no allocation tick is
   * spent on it. Retried webhooks and duplicate deliveries must not consume
   * somebody's share.
   */
  const { data: existing, error: existingError } = await sb.from('leads')
    .select('assigned_to').eq('id', leadId).maybeSingle()
  if (existingError) {
    return { ...none, failure: `Could not read the lead before assigning it: ${existingError.message}` }
  }
  if (existing?.assigned_to) {
    return { chosen: existing.assigned_to as string, weight: null, poolSize: null,
      method: 'already_assigned', failure: null }
  }

  const eligibleIds = new Set(candidates.map(c => c.id))

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    let doc: DistributionDoc, raw: string | null
    try {
      ({ doc, raw } = await readDoc())
    } catch (e) {
      return { ...none, failure: e instanceof Error ? e.message : String(e) }
    }

    // Only people who are eligible AND switched on take part.
    const pool: Member[] = candidates
      .filter(c => doc.members[c.id]?.active !== false)
      .map(c => ({
        id: c.id,
        allocationPercent: Number(doc.members[c.id]?.percent) || 0,
        currentWeight: Number(doc.members[c.id]?.current) || 0,
      }))

    const configured = pool.some(m => m.allocationPercent > 0)

    /*
     * Nobody configured yet: share equally in rotation rather than stopping.
     * Introducing this feature must not halt lead assignment, and the screen
     * says plainly that the shares are unconfigured.
     */
    const effective: Member[] = configured
      ? pool
      : pool.map(m => ({ ...m, allocationPercent: 1 }))

    const pick = pickWeighted(effective)
    if (!pick) {
      return { ...none, failure: 'Nobody eligible is switched on for lead distribution.' }
    }

    const method = configured ? 'weighted' : 'equal_rotation'
    const now = new Date().toISOString()

    const members = { ...doc.members }
    for (const s of pick.nextState) {
      const prev = members[s.id]
      members[s.id] = {
        percent: prev ? Number(prev.percent) || 0 : 0,
        active: prev ? prev.active !== false : true,
        current: s.currentWeight,
        received: (prev ? Number(prev.received) || 0 : 0) + (s.id === pick.chosen ? 1 : 0),
        lastAt: s.id === pick.chosen ? now : (prev?.lastAt ?? null),
      }
    }
    // Anybody not in the pool keeps their state untouched.
    for (const [id, m] of Object.entries(doc.members)) {
      if (!members[id]) members[id] = m
      if (!eligibleIds.has(id)) members[id] = m
    }

    const event: AllocationEvent = {
      leadId, staffId: pick.chosen,
      weight: configured ? pick.weight : null,
      method, at: now, source: opts.source ?? null,
    }

    let won = false
    try {
      won = await writeDoc({
        ...doc, members,
        events: [event, ...doc.events].slice(0, EVENT_LIMIT),
      }, raw)
    } catch (e) {
      return { ...none, failure: e instanceof Error ? e.message : String(e) }
    }

    if (!won) continue   // somebody else allocated first; decide again on fresh state

    /*
     * The claim. assign_lead_to locks the lead row, so this is what makes a
     * double assignment impossible regardless of what the scheduler decided.
     * p_force is false: a lead that acquired an owner in the meantime keeps
     * that owner.
     */
    const { data: claimed, error: claimError } = await sb.rpc('assign_lead_to', {
      p_lead_id: leadId,
      p_marketer: pick.chosen,
      p_actor: null,
      p_reason: method,
      p_source: opts.source || null,
      p_force: false,
    })

    if (claimError) {
      return { ...none, failure: `Could not record the assignment: ${claimError.message}` }
    }

    if (!claimed) {
      /*
       * Somebody else owned it by the time we claimed. The tick already spent
       * is not lost work: this scheduler is deficit-based, so the member who
       * was debited without receiving is now owed one and will be paid first.
       */
      const { data: owner } = await sb.from('leads')
        .select('assigned_to').eq('id', leadId).maybeSingle()
      return { chosen: (owner?.assigned_to as string) || null, weight: null,
        poolSize: pick.poolSize, method: 'already_assigned', failure: null }
    }

    return { chosen: pick.chosen, weight: configured ? pick.weight : null,
      poolSize: pick.poolSize, method, failure: null }
  }

  return { ...none, failure: 'The allocation state was being changed too quickly to settle. The lead is unassigned and can be assigned from the Lead inbox.' }
}

/** The recent allocation decisions, for the History view. */
export async function readAllocationEvents(): Promise<AllocationEvent[]> {
  const { doc } = await readDoc()
  return doc.events
}
