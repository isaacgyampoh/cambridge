import { NextRequest, NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { tableExists } from '@/lib/db/hasColumn'

export const runtime = 'nodejs'

/**
 * Exactly who a campaign went to, and what each of them was sent.
 *
 * ── WHY THIS IS THE LEDGER AND NOT A LEAD SEARCH ───────────────────────────
 *
 * Clicking "250 recipients" has to open those two hundred and fifty records —
 * the people this campaign enrolled, with the text each one received and what
 * became of it. A filtered list of all leads would answer a different
 * question, and would answer it differently tomorrow.
 */
export const GET = withGuard({ portals: ['grp_automation'] }, async (req: NextRequest) => {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('session')
  if (!sessionId) return NextResponse.json({ error: 'Which session?' }, { status: 400 })

  if (!(await tableExists('info_session_recipients'))) {
    return NextResponse.json({
      error: 'This deployment has not run migration 0029, so there is no recipient record to show.',
    }, { status: 503 })
  }

  const status = url.searchParams.get('status')
  const search = (url.searchParams.get('q') || '').trim()
  const page = Math.max(0, Number(url.searchParams.get('page') || '0') || 0)
  const PER_PAGE = 100

  const sb = createServiceClient()
  let q = sb.from('info_session_recipients')
    .select('id, lead_id, phone, email, status, channel, attempts, last_error, sent_at, created_at, message, lead:lead_id(full_name, status, source, course_interest, industry, assigned_to)',
      { count: 'exact' })
    .eq('session_id', sessionId)

  if (status) q = q.eq('status', status)
  /*
   * Searched on the recipient's own columns. The lead's name lives on the
   * joined row, so it is filtered after the read rather than pretending
   * PostgREST can order a search across an embed.
   */
  if (search && /^[0-9+\s()-]+$/.test(search)) q = q.ilike('phone', `%${search.replace(/\D/g, '')}%`)

  const { data, count, error } = await q
    .order('created_at', { ascending: true })
    .range(page * PER_PAGE, page * PER_PAGE + PER_PAGE - 1)

  if (error) {
    console.error('[info-sessions/recipients]', error.message)
    return NextResponse.json({ error: 'The recipients could not be loaded just now.' }, { status: 503 })
  }

  type Row = (typeof data extends (infer R)[] | null ? R : never)
  const byName = (rows: Row[]) => {
    if (!search || /^[0-9+\s()-]+$/.test(search)) return rows
    const needle = search.toLowerCase()
    return rows.filter(r => {
      const lead = r.lead as unknown as { full_name?: string } | null
      return String(lead?.full_name || '').toLowerCase().includes(needle)
    })
  }

  return NextResponse.json({
    success: true,
    total: count ?? 0,
    page,
    perPage: PER_PAGE,
    recipients: byName((data as Row[]) || []).map(r => {
      const lead = r.lead as unknown as {
        full_name?: string; status?: string; source?: string
        course_interest?: string; industry?: string; assigned_to?: string
      } | null
      return {
        id: r.id,
        leadId: r.lead_id,
        name: lead?.full_name || 'Unnamed',
        phone: r.phone,
        email: r.email,
        leadStatus: lead?.status || null,
        source: lead?.source || null,
        course: lead?.course_interest || null,
        industry: lead?.industry || null,
        owner: lead?.assigned_to || null,
        /** What the campaign did with them. */
        status: r.status,
        channel: r.channel,
        attempts: r.attempts,
        reason: r.last_error,
        sentAt: r.sent_at,
        /** The exact text this person was sent. */
        message: r.message,
      }
    }),
  })
})
