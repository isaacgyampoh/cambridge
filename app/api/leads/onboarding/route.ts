import { NextRequest, NextResponse } from 'next/server'
import { isValidCronRequest } from '@/lib/auth/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { onLeadAssigned } from '@/lib/autoAssign'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Greet newly assigned leads.
 *
 * This is the slow half of what the import used to do inline: the welcome
 * pack, the AI opening message and the nurture enrolment — two WhatsApp round
 * trips and an AI call, about eleven seconds a lead. Doing that inside the
 * import request is what made a twenty-lead batch outlive its own function and
 * produce the "some staff get leads, some do not" symptom.
 *
 * Ten at a time, claimed with SKIP LOCKED so two overlapping cron runs take
 * disjoint work rather than both greeting the same person. Ten × eleven
 * seconds is comfortably inside the 300-second ceiling.
 */
export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createServiceClient()
  const { data: due, error } = await sb.rpc('claim_due_onboarding', { p_limit: 10 })

  if (error) {
    if (/could not find|does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({
        ok: false,
        skipped: 'claim_due_onboarding() does not exist — apply migration 0011.',
      })
    }
    console.error('[onboarding] could not claim work:', error.message)
    return NextResponse.json({ ok: false, error: 'Could not claim work.' }, { status: 500 })
  }

  type Job = {
    id: string; lead_id: string; marketer_id: string | null
    attempts: number; max_attempts: number; import_ref: string | null
  }
  const jobs = (due || []) as Job[]

  let done = 0, failed = 0

  for (const job of jobs) {
    const tag = job.import_ref ? `[onboarding ${job.import_ref}]` : '[onboarding]'
    try {
      if (!job.marketer_id) {
        // Nothing to greet on behalf of. Not an error worth retrying.
        await sb.from('lead_onboarding_queue').update({
          status: 'done', finished_at: new Date().toISOString(),
          last_error: 'Lead has no owner; nothing to send.',
        }).eq('id', job.id)
        done++
        continue
      }

      await onLeadAssigned(job.lead_id, job.marketer_id)

      await sb.from('lead_onboarding_queue').update({
        status: 'done', finished_at: new Date().toISOString(), last_error: null,
      }).eq('id', job.id)
      done++

    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unexpected error'
      const exhausted = job.attempts >= job.max_attempts

      // Backoff: 2, then 10 minutes. A greeting is not urgent, and a provider
      // having a bad minute should not burn all three attempts inside one.
      await sb.from('lead_onboarding_queue').update({
        status: exhausted ? 'failed' : 'queued',
        last_error: message.slice(0, 300),
        next_run_at: exhausted
          ? null
          : new Date(Date.now() + (job.attempts === 1 ? 2 : 10) * 60_000).toISOString(),
        finished_at: exhausted ? new Date().toISOString() : null,
      }).eq('id', job.id)

      console.error(`${tag} lead ${job.lead_id} attempt ${job.attempts}:`, message)
      failed++
    }
  }

  return NextResponse.json({ ok: true, claimed: jobs.length, done, failed })
}
