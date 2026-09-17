import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import type { Candidate } from '@/lib/leads/eligibility'

/**
 * The data side of weighted lead distribution.
 *
 * The decision itself runs in the database (distribute_lead_weighted), because
 * picking and claiming have to happen inside one lock. This module is the
 * call, the configuration reads and writes, and the statistics.
 *
 * ── WHY THERE IS A FALLBACK PATH ───────────────────────────────────────────
 *
 * Migration 0021 introduces the table and the function, and migrations on this
 * project are applied by hand. Code reaches production through a deployment,
 * so there is a window in which the new code is live and the new function is
 * not. If that window meant "no lead can be assigned", introducing this
 * feature would take the lead pipeline down.
 *
 * So a missing function is detected specifically — by its own Postgres error
 * code, not by catching everything — and the previous assignment path runs
 * instead. Any OTHER failure is a real failure and is reported as one.
 */

/** Postgres/PostgREST codes for "that function is not there". */
const MISSING_FUNCTION = new Set(['42883', 'PGRST202'])

/** Postgres code for "that table is not there". */
const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

export type DistributionOutcome = {
  chosen: string | null
  weight: number | null
  poolSize: number | null
  method: string | null
  /** True when the configured engine could not be used and the old path ran. */
  degraded: boolean
  /** Set when nothing could be assigned, for the caller to log and surface. */
  failure: string | null
}

/**
 * Choose and claim an owner for a lead, weighted by the configured shares.
 *
 * Returns a chosen id, or a failure that the caller must NOT treat as
 * "assigned to nobody, never mind" — an unassigned lead has to stay
 * detectable and be reported.
 */
export async function distributeLead(
  leadId: string,
  candidates: Candidate[],
  opts: { source?: string | null; campaign?: string | null } = {},
): Promise<DistributionOutcome> {
  const sb = createServiceClient()
  const eligible = candidates.map(c => c.id)

  const { data, error } = await sb.rpc('distribute_lead_weighted', {
    p_lead_id: leadId,
    p_eligible: eligible,
    p_actor: null,
    p_source: opts.source || null,
    p_campaign: opts.campaign || null,
  })

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    if (!row?.chosen) {
      return {
        chosen: null, weight: null, poolSize: null, method: null, degraded: false,
        failure: 'The distributor returned nobody. Nobody eligible is switched on for lead distribution.',
      }
    }
    return {
      chosen: row.chosen as string,
      weight: row.weight === null || row.weight === undefined ? null : Number(row.weight),
      poolSize: row.pool === null || row.pool === undefined ? null : Number(row.pool),
      method: (row.method as string) || null,
      degraded: false,
      failure: null,
    }
  }

  const missing = MISSING_FUNCTION.has(String(error.code)) ||
    /could not find the function|does not exist/i.test(error.message || '')

  if (!missing) {
    // A real database failure. Not silently swallowed, not reported as an
    // ordinary "no candidate" — the lead stays unassigned and this says why.
    return {
      chosen: null, weight: null, poolSize: null, method: null, degraded: false,
      failure: `distribute_lead_weighted failed: ${error.message}`,
    }
  }

  /*
   * Migration 0021 has not been applied to this database yet. Fall back to
   * the path that was there before, so leads keep being assigned, and mark
   * the outcome degraded so it is visible rather than silently second-rate.
   */
  const { data: chosen, error: legacyError } = await sb.rpc('assign_lead_atomic', {
    p_lead_id: leadId,
    p_candidates: eligible,
    p_weights: candidates.map(c => c.weight),
    p_actor: null,
    p_reason: 'auto',
    p_source: opts.source || null,
    p_force: false,
  })

  if (legacyError) {
    return {
      chosen: null, weight: null, poolSize: null, method: null, degraded: true,
      failure: `assign_lead_atomic failed: ${legacyError.message}`,
    }
  }

  return {
    chosen: (chosen as string) || null,
    weight: null,
    poolSize: eligible.length,
    method: 'legacy_least_loaded',
    degraded: true,
    failure: chosen ? null : 'No candidate was chosen.',
  }
}

/** Record whether the assignment notification actually reached anybody. */
export async function recordNotificationOutcome(
  leadId: string, marketerId: string, ok: boolean, errorText?: string | null,
): Promise<void> {
  const sb = createServiceClient()
  await sb.rpc('record_assignment_notification', {
    p_lead_id: leadId,
    p_marketer: marketerId,
    p_ok: ok,
    p_error: errorText || null,
  }).then(() => {}, () => {
    // Best effort by design: this is a note ABOUT a notification, and failing
    // to write it must not disturb an assignment that already succeeded.
  })
}

/* ── Configuration ────────────────────────────────────────────────────────── */

export type MemberRow = {
  profileId: string
  fullName: string
  role: string
  allocationPercent: number
  isActive: boolean
  profileActive: boolean
  currentWeight: number
  leadsReceived: number
  lastAssignedAt: string | null
  /** Present in the members table at all, or only eligible-by-portal. */
  configured: boolean
}

export type ConfigReadResult =
  | { ok: true; members: MemberRow[]; tableMissing: boolean }
  | { ok: false; reason: string }

/**
 * Everybody who may receive a lead, with their configured share.
 *
 * Built from the eligible pool rather than from the members table, so a
 * newly-eligible person appears on the screen at zero rather than being
 * invisible until somebody thinks to add them.
 */
export async function readDistributionConfig(candidates: Candidate[]): Promise<ConfigReadResult> {
  const sb = createServiceClient()

  const { data, error } = await sb.from('lead_distribution_members')
    .select('profile_id, allocation_percent, is_active, current_weight, leads_received, last_assigned_at')

  if (error && !(MISSING_TABLE.has(String(error.code)) || /does not exist|Could not find the table/i.test(error.message || ''))) {
    // A failed read is not an empty configuration. Saying "everyone is on 0%"
    // because the database was unreachable would be a lie the screen then
    // invites somebody to save over the real thing.
    return { ok: false, reason: error.message }
  }

  const tableMissing = !!error
  const byId = new Map((data || []).map(r => [r.profile_id as string, r]))

  const members: MemberRow[] = candidates.map(c => {
    const row = byId.get(c.id)
    return {
      profileId: c.id,
      fullName: c.fullName,
      role: c.role,
      allocationPercent: row ? Number(row.allocation_percent) : 0,
      isActive: row ? !!row.is_active : true,
      profileActive: true,
      currentWeight: row ? Number(row.current_weight) : 0,
      leadsReceived: row ? Number(row.leads_received) : 0,
      lastAssignedAt: (row?.last_assigned_at as string) || null,
      configured: !!row,
    }
  })

  return { ok: true, members, tableMissing }
}

export type SaveRow = { profileId: string; allocationPercent: number; isActive: boolean }

/**
 * Write the configuration.
 *
 * Every row is upserted on profile_id, which is the primary key, so a
 * duplicate in the payload collapses onto one row rather than creating a
 * second share for the same person.
 *
 * current_weight is deliberately NOT reset. Resetting it on every save would
 * throw away the accumulated debt and hand whoever happens to be first in the
 * next cycle a burst — the "huge temporary bias" that makes a percentage
 * change look broken.
 */
export async function saveDistributionConfig(
  rows: SaveRow[], actorId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sb = createServiceClient()

  const payload = rows.map(r => ({
    profile_id: r.profileId,
    allocation_percent: r.allocationPercent,
    is_active: r.isActive,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  }))

  const { error } = await sb.from('lead_distribution_members')
    .upsert(payload, { onConflict: 'profile_id' })

  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}
