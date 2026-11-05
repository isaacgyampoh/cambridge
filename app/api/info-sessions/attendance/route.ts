import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { tableExists } from '@/lib/db/hasColumn'

export const runtime = 'nodejs'

/*
 * The grp_automation portal, the same answer the page guard and the API path
 * guard give — see the note in ../route.ts for what disagreeing cost.
 */
const PORTALS = ['grp_automation']

/**
 * WHO DROVE ATTENDANCE.
 *
 * ── WHAT IT USED TO SAY, AND WHY IT WAS MISLEADING ─────────────────────────
 *
 * It counted rows in info_session_joins and grouped them by the marketer code
 * in the link that was clicked. Two things were wrong with that.
 *
 * First, it counted CLICKS, not people: thirty-five rows from twenty-one
 * leads was reported as thirty-five, and a heading that says "26 joined" when
 * twenty-one people joined is a number management will plan against.
 *
 * Second, it presented one relationship as though it were the answer to a
 * different question. Whose link somebody clicked is who INVITED them. It is
 * not who found them, and not who is responsible for them — on this data most
 * leads were imported and assigned afterwards, so the inviter and the owner
 * are usually different people and neither is the source.
 *
 * ── WHAT IT SAYS NOW ───────────────────────────────────────────────────────
 *
 * Three breakdowns of the SAME distinct attendees, each answering its own
 * question, and each able to say "not recorded" rather than guess:
 *
 *   by source   where the lead originally came from (leads.source)
 *   by owner    which staff member is responsible   (leads.assigned_to)
 *   by inviter  whose join link was used            (join.marketer_id)
 *
 * Invited comes from the campaign's own recipient ledger, so an attendance
 * rate is attendees over people actually messaged — not over everybody who
 * happened to be in the database.
 */
export const GET = withGuard({ portals: PORTALS }, async (req: NextRequest) => {
  const sessionId = new URL(req.url).searchParams.get('session_id')
  const sb = createServiceClient()

  let joinQuery = sb.from('info_session_joins')
    .select('session_id, marketer_id, lead_id, created_at, info_sessions(title, scheduled_at)')
  if (sessionId) joinQuery = joinQuery.eq('session_id', sessionId)

  const { data: joins, error } = await joinQuery.limit(5000)
  if (error) {
    console.error('[info-sessions/attendance]', error.message)
    return NextResponse.json({ error: 'Attendance could not be read just now.' }, { status: 503 })
  }

  /*
   * One row per PERSON per session. Somebody who opened the link three times
   * attended once; counting the clicks is what made the figures bigger than
   * the room.
   */
  const attendees = new Map<string, Map<string, { leadId: string; marketerId: string | null }>>()
  const meta = new Map<string, { title: string; scheduledAt: string | null }>()

  for (const j of joins || []) {
    const sid = String(j.session_id)
    const leadId = j.lead_id ? String(j.lead_id) : null
    if (!meta.has(sid)) {
      const s = j.info_sessions as unknown as { title?: string; scheduled_at?: string } | null
      meta.set(sid, { title: s?.title || 'Info session', scheduledAt: s?.scheduled_at || null })
    }
    if (!attendees.has(sid)) attendees.set(sid, new Map())
    // A lead with no id cannot be told apart from another, so it is counted
    // once per join and labelled as unidentified rather than merged.
    const key = leadId || `anon:${j.created_at}`
    if (!attendees.get(sid)!.has(key)) {
      attendees.get(sid)!.set(key, { leadId: leadId || '', marketerId: j.marketer_id ? String(j.marketer_id) : null })
    }
  }

  const leadIds = [...new Set([...attendees.values()].flatMap(m => [...m.values()].map(a => a.leadId).filter(Boolean)))]
  const marketerIds = [...new Set([...attendees.values()].flatMap(m => [...m.values()].map(a => a.marketerId).filter(Boolean) as string[]))]

  const leadById = new Map<string, { source: string | null; assigned_to: string | null; full_name: string | null }>()
  if (leadIds.length) {
    const { data: leads } = await sb.from('leads').select('id, source, assigned_to, full_name').in('id', leadIds)
    for (const l of leads || []) {
      leadById.set(l.id as string, {
        source: (l.source as string) || null,
        assigned_to: (l.assigned_to as string) || null,
        full_name: (l.full_name as string) || null,
      })
    }
  }

  const nameById = new Map<string, string>()
  const ownerIds = [...new Set([...leadById.values()].map(l => l.assigned_to).filter(Boolean) as string[])]
  const staffIds = [...new Set([...marketerIds, ...ownerIds])]
  if (staffIds.length) {
    const { data: staff } = await sb.from('profiles').select('id, full_name').in('id', staffIds)
    for (const p of staff || []) nameById.set(p.id as string, (p.full_name as string) || 'Unnamed')
  }

  // How many were invited — from the campaign's own ledger where there is one.
  const invitedBySession = new Map<string, number>()
  if (await tableExists('info_session_recipients')) {
    for (const sid of attendees.keys()) {
      const { count } = await sb.from('info_session_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sid)
      invitedBySession.set(sid, count ?? 0)
    }
  }

  const tally = (rows: Array<string | null>, label: (k: string) => string) => {
    const counts = new Map<string, number>()
    for (const raw of rows) {
      const key = raw || '__unknown__'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()]
      .map(([key, attended]) => ({
        key,
        // Never invented. The data either records it or it does not.
        label: key === '__unknown__' ? 'Not recorded' : label(key),
        attended,
      }))
      .sort((a, b) => b.attended - a.attended || a.label.localeCompare(b.label))
  }

  const sessions = [...attendees.entries()].map(([sid, people]) => {
    const list = [...people.values()]
    const invited = invitedBySession.get(sid) ?? null
    const attended = list.length

    return {
      session_id: sid,
      title: meta.get(sid)?.title || 'Info session',
      scheduled_at: meta.get(sid)?.scheduledAt || null,
      /** Distinct people, not clicks. */
      attended,
      invited,
      absent: invited === null ? null : Math.max(0, invited - attended),
      attendanceRate: invited ? Math.round((attended / invited) * 100) : null,
      bySource: tally(list.map(a => leadById.get(a.leadId)?.source ?? null), k => k.replace(/_/g, ' ')),
      byOwner: tally(list.map(a => leadById.get(a.leadId)?.assigned_to ?? null), k => nameById.get(k) || 'Unknown staff member'),
      byInviter: tally(list.map(a => a.marketerId), k => nameById.get(k) || 'Unknown staff member'),
    }
  }).sort((a, b) => new Date(b.scheduled_at || 0).getTime() - new Date(a.scheduled_at || 0).getTime())

  return NextResponse.json({
    sessions,
    /** Said in the response as well as the interface, so it travels with the data. */
    explanation: 'Who drove attendance shows which lead sources and responsible staff members '
      + 'contributed to the people who attended this info session. Attendance counts each person '
      + 'once, however many times they opened the link. "Invited" is the number of people the '
      + 'campaign actually messaged.',
  })
})
