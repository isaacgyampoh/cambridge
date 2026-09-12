import { NextResponse } from 'next/server'
import { withGuard } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { aiConfigured } from '@/lib/integrations/ai-client'
import { SECRETS } from '@/lib/config.server'
import { loadProgrammes } from '@/lib/chatbot/programme'
import { loadKnowledge } from '@/lib/chatbot/knowledge'
import { capabilityOf } from '@/lib/chatbot/programmeRules'
import { eligibleMarketers } from '@/lib/leads/eligibility'

export const runtime = 'nodejs'

/**
 * Can the assistant actually do its job with THIS centre's data?
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every guarantee the assistant makes depends on data it reads at run time,
 * and a repository cannot tell you what is in a database. The tests prove
 * that a fee present in a record reaches the model and that a fee absent from
 * one is never invented — they cannot prove your courses have fees on them.
 *
 * That gap has already cost this system twice, both times silently:
 *
 *   courses.price               a column nothing writes, read by the fee
 *                               loader — so no fee ever reached the model,
 *                               while it was told to quote fees only from
 *                               the facts given to it
 *   lead_assign_pending.last_sms_at
 *                               a column that does not exist, written by the
 *                               notification sweep — so the statement failed
 *                               as a unit and every assignment SMS stopped
 *
 * Neither showed up in a build, a type check or a test. Both would have shown
 * up here in one request.
 *
 * So this runs the assistant's OWN loaders against the live database and
 * reports what they actually came back with. Not a mock, not a re-implemented
 * query — the same loadProgrammes and loadKnowledge the conversation uses, so
 * a schema that has drifted from this repository shows up as the assistant
 * losing an ability rather than as nothing at all.
 */

type Check = {
  id: string
  label: string
  /** ok = working. warn = degraded but safe. fail = the assistant cannot do this. */
  status: 'ok' | 'warn' | 'fail'
  detail: string
  /** What to do about it, when there is something to do. */
  fix?: string
}

export const GET = withGuard({ portals: ['settings'] }, async () => {
  const sb = createServiceClient()
  const checks: Check[] = []

  // ── 1. The model ─────────────────────────────────────────────────────────
  checks.push(
    !SECRETS.aiAssistantEnabled
      ? { id: 'model', label: 'AI replies', status: 'warn',
          detail: 'Switched off in configuration. The assistant will not answer anything.',
          fix: 'Set the assistant to enabled in lib/config.server.' }
      : aiConfigured()
        ? { id: 'model', label: 'AI replies', status: 'ok', detail: `Configured (${SECRETS.aiProvider}).` }
        : { id: 'model', label: 'AI replies', status: 'fail',
            detail: 'No API key is reaching the server, so every message falls back to a person.',
            fix: 'Add the provider API key in Vercel and redeploy.' },
  )

  // ── 2. The fee contract ──────────────────────────────────────────────────
  /*
   * The check that would have caught the `price` bug on the day it shipped.
   * It runs the real loader, then counts how many active programmes came back
   * with a fee on them.
   */
  let programmes: Awaited<ReturnType<typeof loadProgrammes>> = []
  try {
    programmes = await loadProgrammes()
  } catch (e) {
    checks.push({ id: 'programmes', label: 'Programmes', status: 'fail',
      detail: `The programme loader threw: ${e instanceof Error ? e.message : e}`,
      fix: 'The courses table cannot be read at all. Check the service key and the table name.' })
  }

  if (programmes.length) {
    const withFee = programmes.filter(p => p.feeInPerson !== null || p.feeOnline !== null)
    checks.push({
      id: 'programmes', label: 'Programmes', status: 'ok',
      detail: `${programmes.length} active programme${programmes.length === 1 ? '' : 's'} loaded.`,
    })
    checks.push(
      withFee.length === programmes.length
        ? { id: 'fees', label: 'Course fees', status: 'ok',
            detail: `All ${programmes.length} have a fee recorded.` }
        : withFee.length === 0
          ? { id: 'fees', label: 'Course fees', status: 'fail',
              detail: 'Not one active programme has a fee the assistant can read. It will refuse every question about price and hand the conversation to a person.',
              fix: 'Set "Course fee — in person" on each programme under Academics → Courses. If they are already set there, the database column differs from course_fee and the loader needs updating.' }
          : { id: 'fees', label: 'Course fees', status: 'warn',
              detail: `${withFee.length} of ${programmes.length} have a fee. The rest: ${programmes.filter(p => !withFee.includes(p)).map(p => p.name).slice(0, 5).join(', ')}.`,
              fix: 'Set a fee on those under Academics → Courses, or the assistant will hand every price question about them to a person.' },
    )

    // ── 3. Brochures and cohorts, per programme ────────────────────────────
    const withBrochure = programmes.filter(p => p.brochureUrl)
    checks.push({
      id: 'brochures', label: 'Brochures', status: withBrochure.length ? 'ok' : 'warn',
      detail: `${withBrochure.length} of ${programmes.length} have a brochure on file.`,
      fix: withBrochure.length === programmes.length ? undefined
        : 'The assistant will not offer a brochure for the others, and will pass anyone who asks to a person. Upload one under Academics → Courses.',
    })

    const withCohort = programmes.filter(p => p.cohorts.length)
    checks.push({
      id: 'cohorts', label: 'Scheduled cohorts', status: withCohort.length ? 'ok' : 'warn',
      detail: `${withCohort.length} of ${programmes.length} have a class running or starting soon.`,
      fix: withCohort.length ? undefined
        : 'With no scheduled class the assistant cannot answer "when does it start" for any programme, and will say it will confirm. Add a batch under Academics → Classes.',
    })
  }

  // ── 4. What the assistant can actually offer ─────────────────────────────
  if (programmes.length) {
    const sample = programmes[0]
    const cap = capabilityOf(sample, 'https://example/apply/CODE')
    const able = Object.entries(cap).filter(([, v]) => v).map(([k]) => k.replace('can', ''))
    checks.push({
      id: 'actions', label: 'Options offered to a lead', status: able.length > 1 ? 'ok' : 'warn',
      detail: `For "${sample.name}" the assistant can offer: ${able.length ? able.join(', ') : 'nothing but speaking to a person'}.`,
      fix: able.length > 1 ? undefined : 'Add a fee, a brochure and a scheduled class so the assistant has something to offer.',
    })
  }

  // ── 5. The centre's own knowledge ────────────────────────────────────────
  try {
    const k = await loadKnowledge()
    const total = k.counts.info + k.counts.faqs
    checks.push({
      id: 'knowledge', label: 'Knowledge base', status: total ? 'ok' : 'warn',
      detail: total
        ? `${k.counts.info} facts and ${k.counts.faqs} questions the assistant may answer from.`
        : 'Empty. The assistant can still answer from programme records, but nothing about the centre itself.',
      fix: total ? undefined : 'Add entries under Knowledge so it can answer where you are, how payment works, and what to bring.',
    })
  } catch (e) {
    checks.push({ id: 'knowledge', label: 'Knowledge base', status: 'fail',
      detail: `Could not be read: ${e instanceof Error ? e.message : e}` })
  }

  // ── 6. Who can receive a lead, and be named in a handover ────────────────
  try {
    const pool = await eligibleMarketers()
    checks.push({
      id: 'pool', label: 'Lead recipients', status: pool.length ? 'ok' : 'fail',
      detail: pool.length
        ? `${pool.length} can receive a lead.`
        : 'Nobody holds the leads access, so no lead can be assigned and no handover has anyone to go to.',
      fix: pool.length ? undefined : 'Grant the "My leads" permission to at least one person under Staff.',
    })

    const { count: withCode } = await sb.from('profiles')
      .select('id', { count: 'exact', head: true })
      .not('marketer_code', 'is', null)
    checks.push({
      id: 'links', label: 'Registration links', status: (withCode || 0) >= pool.length ? 'ok' : 'warn',
      detail: `${withCode || 0} staff have a personal registration code.`,
      fix: (withCode || 0) >= pool.length ? undefined
        : 'Anyone without one cannot have registration offered to their leads, because there is nowhere to send them.',
    })
  } catch (e) {
    checks.push({ id: 'pool', label: 'Lead recipients', status: 'fail',
      detail: `Could not be read: ${e instanceof Error ? e.message : e}` })
  }

  // ── 7. Conversations currently waiting on a person ───────────────────────
  try {
    const { count: waiting } = await sb.from('leads')
      .select('id', { count: 'exact', head: true }).eq('needs_human', true)
    const { count: paused } = await sb.from('leads')
      .select('id', { count: 'exact', head: true }).eq('ai_paused', true)
    const orphaned = Math.max(0, (paused || 0) - (waiting || 0))

    checks.push({
      id: 'waiting', label: 'Waiting for a person', status: (waiting || 0) > 10 ? 'warn' : 'ok',
      detail: `${waiting || 0} conversation${waiting === 1 ? '' : 's'} handed over and waiting.`,
      fix: (waiting || 0) > 10
        ? 'The assistant does not resume these on its own — by design. Somebody has to answer them, or resume the assistant from Settings.'
        : undefined,
    })

    if (orphaned > 0) {
      checks.push({
        id: 'orphaned', label: 'Paused without a handover', status: 'warn',
        detail: `${orphaned} lead${orphaned === 1 ? ' is' : 's are'} paused but not marked as waiting for anyone. Nobody is answering them.`,
        fix: 'These are usually a colleague replying on the line. If that is not it, Resume AI under Settings clears them.',
      })
    }
  } catch { /* the counts are a nicety; their absence is not a failure */ }

  // ── 8. A line to send from ───────────────────────────────────────────────
  try {
    const { count } = await sb.from('profiles')
      .select('id', { count: 'exact', head: true }).eq('wasender_status', 'connected')
    const central = !!SECRETS.wasenderApiKey
    checks.push({
      id: 'whatsapp', label: 'WhatsApp line', status: (count || central) ? 'ok' : 'fail',
      detail: count ? `${count} connected line${count === 1 ? '' : 's'}${central ? ', plus the central line' : ''}.`
        : central ? 'The central line only. Replies will not come from a marketer’s own number.'
        : 'No connected line. Nothing the assistant writes can be delivered.',
      fix: (count || central) ? undefined : 'Connect a line under WhatsApp lines.',
    })
  } catch { /* as above */ }

  const worst = checks.some(c => c.status === 'fail') ? 'fail'
    : checks.some(c => c.status === 'warn') ? 'warn' : 'ok'

  return NextResponse.json({
    status: worst,
    summary: worst === 'ok' ? 'The assistant has everything it needs.'
      : worst === 'warn' ? 'The assistant will work, but some answers will go to a person.'
      : 'The assistant cannot do part of its job. See below.',
    checks,
  })
})
