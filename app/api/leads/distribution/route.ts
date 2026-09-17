import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifySession } from '@/lib/auth/pin'
import { createServiceClient } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { eligibleMarketers } from '@/lib/leads/eligibility'
import {
  readDistributionConfig, saveDistributionConfig, type MemberRow,
} from '@/lib/leads/distributionStore'
import { validateAllocations, varianceFor, round2 } from '@/lib/leads/distribution'
import { unavailable, saveFailed } from '@/lib/db/lookup'

export const runtime = 'nodejs'

/**
 * Lead distribution: the configured shares, and what actually happened.
 *
 * Available to the super admin and the project manager, through the existing
 * role check. The PM gets exactly this — the allocation, the statistics, the
 * history and the unassigned count — and no wider powers.
 *
 * ── WHERE THE STATISTICS COME FROM ─────────────────────────────────────────
 *
 * lead_assignments, not leads.assigned_to. They answer different questions:
 * the leads table says who holds a lead NOW, which changes every time
 * somebody is reassigned, while the assignment rows say who it was given to
 * and when. A share is a statement about distribution events over a period,
 * so it has to be counted from the events.
 */

const ALLOWED_ROLES = ['super_admin', 'project_manager']

const PERIODS: Record<string, number | null> = {
  today: 0, '7d': 7, '30d': 30, '90d': 90, all: null,
}

function sinceFor(period: string): string | null {
  const days = PERIODS[period]
  if (days === null || days === undefined) return null
  const d = new Date()
  if (days === 0) d.setHours(0, 0, 0, 0)
  else d.setDate(d.getDate() - days)
  return d.toISOString()
}

async function guard(req: NextRequest) {
  const token = req.cookies.get('cce_session')?.value
  const session: { valid?: boolean; role?: string; userId?: string } =
    token ? await verifySession(token) : { valid: false }
  if (!session.valid || !ALLOWED_ROLES.includes(session.role || '')) return null
  return session
}

export async function GET(req: NextRequest) {
  const session = await guard(req)
  if (!session) {
    return NextResponse.json(
      { error: 'Only a super admin or project manager can view lead distribution.' },
      { status: 403 },
    )
  }

  const period = req.nextUrl.searchParams.get('period') || '30d'
  if (!(period in PERIODS)) {
    return NextResponse.json({ error: 'Unknown period.' }, { status: 400 })
  }

  let candidates
  try {
    candidates = await eligibleMarketers()
  } catch (e) {
    return unavailable('[leads/distribution]', String(e), 'the staff who can receive leads')
  }

  const config = await readDistributionConfig(candidates)
  if (!config.ok) {
    return unavailable('[leads/distribution]', config.reason, 'the distribution settings')
  }

  const sb = createServiceClient()
  const since = sinceFor(period)

  /*
   * Assignment events in the period. A failed read here is reported, never
   * rendered as "nobody received anything" — which would read as a
   * catastrophic distribution failure rather than a database blip.
   */
  /*
   * Assignment events in the period, from the columns that have always
   * existed. A failed read is reported, never rendered as "nobody received
   * anything" — which would read as a catastrophic distribution failure
   * rather than a database blip.
   */
  let eventQuery = sb.from('lead_assignments')
    .select('to_marketer, created_at, reason')
    .not('to_marketer', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (since) eventQuery = eventQuery.gte('created_at', since)

  const { data: eventsData, error: eventError } = await eventQuery
  if (eventError) {
    return unavailable('[leads/distribution]', eventError.message, 'the assignment history')
  }
  const events = eventsData || []

  const received: Record<string, number> = {}
  for (const e of events) {
    const id = e.to_marketer as string
    received[id] = (received[id] ?? 0) + 1
  }

  const totalAssigned = events.length

  /*
   * Notifications that genuinely failed, counted from the notes the assigner
   * writes when one does. Not a placeholder: an empty result here means none
   * failed, and a failed read is reported rather than shown as zero.
   */
  let notifyQuery = sb.from('lead_activities')
    .select('id', { count: 'exact', head: true })
    .eq('subject', 'Assignment notification failed')
  if (since) notifyQuery = notifyQuery.gte('created_at', since)
  const { count: notifyFailuresCount, error: notifyError } = await notifyQuery
  if (notifyError) {
    return unavailable('[leads/distribution]', notifyError.message, 'the notification failures')
  }
  const notifyFailures = notifyFailuresCount ?? 0

  const members = config.members.map((m: MemberRow) => ({
    ...m,
    receivedInPeriod: received[m.profileId] ?? 0,
    ...varianceFor(received[m.profileId] ?? 0, totalAssigned, m.allocationPercent),
  }))

  // Leads with no owner at all. This is the number that tells a PM whether
  // anything is falling through, and it is counted, not estimated.
  const { count: unassigned, error: unassignedError } = await sb.from('leads')
    .select('id', { count: 'exact', head: true }).is('assigned_to', null)
  if (unassignedError) {
    return unavailable('[leads/distribution]', unassignedError.message, 'the unassigned lead count')
  }

  /*
   * Leads sitting with somebody who cannot open a leads page. These are the
   * ones staff describe as having disappeared: assigned, recorded, and
   * invisible to everybody including the person holding them.
   */
  const eligibleIds = new Set(candidates.map(c => c.id))
  const { data: holders, error: holderError } = await sb.from('leads')
    .select('assigned_to').not('assigned_to', 'is', null).limit(5000)
  if (holderError) {
    return unavailable('[leads/distribution]', holderError.message, 'the current lead holders')
  }
  const strandedBy: Record<string, number> = {}
  for (const h of holders || []) {
    const id = h.assigned_to as string
    if (!eligibleIds.has(id)) strandedBy[id] = (strandedBy[id] ?? 0) + 1
  }
  const stranded = Object.values(strandedBy).reduce((a, b) => a + b, 0)

  const configuredTotal = round2(
    members.filter(m => m.isActive).reduce((s, m) => s + m.allocationPercent, 0),
  )

  return NextResponse.json({
    period,
    members,
    totalAssigned,
    unassigned: unassigned ?? 0,
    stranded,
    strandedHolders: Object.keys(strandedBy).length,
    notifyFailures,
    configuredTotal,
    /*
     * True until migration 0021 is applied. The screen says so plainly rather
     * than showing percentages that are not in force.
     */
    /*
     * The engine is always installed now: the configuration lives in the
     * settings table this application already uses, so there is no migration
     * standing between a manager and a working allocation.
     */
    engineReady: true,
    unconfigured: configuredTotal === 0,
  })
}

const Body = z.object({
  rows: z.array(z.object({
    profileId: z.string().uuid(),
    allocationPercent: z.number().min(0).max(100),
    isActive: z.boolean(),
  })).min(1).max(200),
})

export async function POST(req: NextRequest) {
  const session = await guard(req)
  if (!session) {
    return NextResponse.json(
      { error: 'Only a super admin or project manager can change lead distribution.' },
      { status: 403 },
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'That allocation could not be read.' }, { status: 400 })
  }

  let candidates
  try {
    candidates = await eligibleMarketers()
  } catch (e) {
    return unavailable('[leads/distribution]', String(e), 'the staff who can receive leads')
  }
  const eligibleIds = new Set(candidates.map(c => c.id))

  // Nobody can be given a share who is not eligible to hold a lead at all.
  for (const r of parsed.data.rows) {
    if (!eligibleIds.has(r.profileId)) {
      return NextResponse.json({
        error: 'One of those people cannot receive leads, so they cannot be given a share.',
      }, { status: 400 })
    }
  }

  const issues = validateAllocations(parsed.data.rows.map(r => ({
    id: r.profileId, allocationPercent: r.allocationPercent, isActive: r.isActive,
  })))
  if (issues.length) {
    return NextResponse.json({ error: issues[0].message, issues }, { status: 400 })
  }

  // Read the current values BEFORE writing, so the audit entry records what
  // actually changed rather than only what it was changed to.
  const before = await readDistributionConfig(candidates)
  if (!before.ok) {
    return unavailable('[leads/distribution]', before.reason, 'the current distribution settings')
  }
  const previous = new Map(before.members.map(m => [m.profileId, m]))

  const saved = await saveDistributionConfig(parsed.data.rows, session.userId as string)
  if (!saved.ok) {
    return saveFailed('[leads/distribution]', saved.reason, 'the lead distribution settings')
  }

  const changes = parsed.data.rows
    .map(r => {
      const was = previous.get(r.profileId)
      if (was && was.allocationPercent === r.allocationPercent && was.isActive === r.isActive) return null
      return {
        profileId: r.profileId,
        name: was?.fullName || null,
        fromPercent: was?.allocationPercent ?? null,
        toPercent: r.allocationPercent,
        fromActive: was?.isActive ?? null,
        toActive: r.isActive,
      }
    })
    .filter(Boolean)

  await recordAudit({
    actorId: session.userId,
    action: 'leads.distribution_changed',
    resource: 'lead_distribution_members',
    success: true,
    request: req,
    metadata: { changes },
  })

  return NextResponse.json({ success: true, changed: changes.length })
}
