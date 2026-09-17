import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import type { Candidate } from '@/lib/leads/eligibility'
import { runCycle } from '@/lib/leads/distribution'

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

/*
 * THE ALLOCATION HISTORY LIVES IN ITS OWN ROW, AND THIS IS NOT COSMETIC.
 *
 * It used to sit inside the document below, and the document is what the
 * compare-and-swap matches on. PostgREST puts filters in the QUERY STRING, so
 * `.eq('value', <the whole document>)` becomes a URL containing the whole
 * document — about 80KB once a few hundred allocations had accumulated,
 * against a limit that is typically 8KB.
 *
 * Every allocation write therefore failed, the retry loop exhausted itself,
 * and no lead was assigned. It worked when the document was empty and broke
 * as it filled, which is the worst shape a bug can have: it passes every test
 * written against a fresh database and stops the business days later.
 *
 * Members only, the document stays around 1.4KB and the filter URL around
 * 2KB. The history is written separately and unconditionally: it is an audit
 * convenience, so losing a race on it costs a log line, not an assignment.
 */
const EVENTS_KEY = 'lead_distribution_events'

/*
 * The compare-and-swap token. A short number in its own row, so the filter
 * that guards a write is a few bytes whatever the state grows to.
 */
const VERSION_KEY = 'lead_distribution_version'



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
  updatedAt: string | null
  updatedBy: string | null
}

const EMPTY: DistributionDoc = {
  version: 0, members: {}, updatedAt: null, updatedBy: null,
}

function parseDoc(raw: string | null | undefined): DistributionDoc {
  if (!raw) return { ...EMPTY }
  try {
    const parsed = JSON.parse(raw) as Partial<DistributionDoc>
    return {
      version: Number(parsed.version) || 0,
      members: parsed.members && typeof parsed.members === 'object' ? parsed.members : {},
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

type ReadResult = { doc: DistributionDoc; version: number }

/**
 * Read the state, and the version token that guards it.
 *
 * Returns null when a writer is part-way through — the token has moved but
 * the document it describes has not landed yet — so the caller retries rather
 * than computing from a state that is about to change.
 */
async function readState(): Promise<ReadResult | null> {
  const sb = createServiceClient()

  const { data, error } = await sb.from('settings')
    .select('key, value').in('key', [KEY, VERSION_KEY])

  // A failed read is not an empty configuration.
  if (error) throw new Error(error.message)

  const rows = new Map((data || []).map(r => [r.key as string, r.value as string | null]))
  const doc = parseDoc(rows.get(KEY) ?? null)
  const version = Number(rows.get(VERSION_KEY) ?? 0) || 0

  /*
   * The token is bumped before the document is written, so a mismatch means
   * another request is between those two steps. Its write is about to land;
   * deciding from what is here now would discard it.
   */
  if (doc.version !== version) return null

  return { doc, version }
}

/**
 * Claim the next version, then write the document.
 *
 * ── WHY THE COMPARE IS ON A NUMBER AND NOT ON THE DOCUMENT ─────────────────
 *
 * It used to be `.eq('value', <the whole document>)`. PostgREST puts filters
 * in the QUERY STRING, so that built a URL containing the entire document —
 * about 80KB once allocation history had accumulated, against a limit that is
 * typically 8KB. Every write was refused, the retry loop exhausted itself,
 * and NO LEAD WAS ASSIGNED.
 *
 * Moving the history to its own row helped but did not fix it: the members
 * alone pass 8KB at around fifty people, so the fault would simply have
 * returned as the team grew.
 *
 * The compare is now on a version token — a short number in its own row — so
 * the filter is a handful of bytes whatever the state contains. Winning that
 * compare is what grants the right to write the document.
 */
async function writeState(next: DistributionDoc, version: number): Promise<boolean> {
  const sb = createServiceClient()
  const nextVersion = version + 1

  if (version === 0) {
    /*
     * No token yet. Create it; a second request creating it at the same
     * moment updates instead of failing on the unique key, and simply loses
     * the next compare.
     */
    const { error } = await sb.from('settings')
      .upsert({ key: VERSION_KEY, value: String(nextVersion) }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await sb.from('settings')
      .update({ value: String(nextVersion) })
      .eq('key', VERSION_KEY)
      .eq('value', String(version))     // ← the compare, always a few bytes
      .select('key')
    if (error) throw new Error(error.message)
    if ((data?.length ?? 0) === 0) return false   // somebody else got there first
  }

  /*
   * The token is ours, so this write is uncontended by construction. The
   * version inside the document matches the token, which is what lets a
   * reader tell a settled state from one mid-write.
   */
  const { error: docError } = await sb.from('settings')
    .upsert({ key: KEY, value: JSON.stringify({ ...next, version: nextVersion }) },
      { onConflict: 'key' })
  if (docError) throw new Error(docError.message)

  return true
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
    // A state mid-write reads as settled a moment later; for a screen, the
    // previous values are the right thing to show meanwhile.
    const state = await readState()
    doc = state ? state.doc : (await readState())?.doc ?? { version: 0, members: {}, updatedAt: null, updatedBy: null }
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

  return { ok: true, members, events: await readAllocationEvents() }
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
    let state: ReadResult | null
    try {
      state = await readState()
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
    if (!state) continue          // a write is landing; look again
    const { doc, version } = state

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
      const won = await writeState({
        ...doc, members,
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      }, version)
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
    let state: ReadResult | null
    try {
      state = await readState()
    } catch (e) {
      return { ...none, failure: e instanceof Error ? e.message : String(e) }
    }
    if (!state) continue          // a write is landing; look again
    const { doc, version } = state

    // Only people who are eligible AND switched on take part.
    /*
     * The decision, and the state to save, computed by the pure module — so
     * the whole cycle is under test against the real implementation rather
     * than asserted by reading the source.
     */
    const cycle = runCycle(doc.members, candidates, new Date().toISOString())
    if (!cycle) {
      return { ...none, failure: 'Nobody eligible is switched on for lead distribution.' }
    }
    const { chosen, weight, method, members } = cycle
    const now = members[chosen]?.lastAt || new Date().toISOString()

    let won = false
    try {
      won = await writeState({ ...doc, members }, version)
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
      p_marketer: chosen,
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
        poolSize: cycle.poolSize, method: 'already_assigned', failure: null }
    }

    /*
     * Recorded after the claim, in its own row, and never allowed to fail the
     * assignment: the lead has an owner either way.
     */
    await appendEvent({
      leadId, staffId: chosen,
      weight, method, at: now, source: opts.source ?? null,
    })

    return { chosen, weight, poolSize: cycle.poolSize, method, failure: null }
  }

  return { ...none, failure: 'The allocation state was being changed too quickly to settle. The lead is unassigned and can be assigned from the Lead inbox.' }
}

/** The recent allocation decisions, for the History view. */
export async function readAllocationEvents(): Promise<AllocationEvent[]> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb.from('settings')
      .select('value').eq('key', EVENTS_KEY).maybeSingle()
    if (error || !data?.value) return []
    const parsed = JSON.parse(data.value as string)
    return Array.isArray(parsed) ? parsed as AllocationEvent[] : []
  } catch {
    // The history is a convenience. Losing it must not disturb anything.
    return []
  }
}

/**
 * Add one decision to the history.
 *
 * Deliberately unconditional — no compare-and-swap. Two allocations landing
 * together can lose one history entry, and that is the right trade: the
 * alternative put this in the document the allocator matches on, which made
 * the filter URL too large to send and stopped leads being assigned at all.
 */
async function appendEvent(event: AllocationEvent): Promise<void> {
  try {
    const sb = createServiceClient()
    const existing = await readAllocationEvents()
    const next = [event, ...existing].slice(0, EVENT_LIMIT)
    await sb.from('settings')
      .upsert({ key: EVENTS_KEY, value: JSON.stringify(next) }, { onConflict: 'key' })
  } catch (e) {
    console.error('[distribution] could not record the allocation event:', e)
  }
}
