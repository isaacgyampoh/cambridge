import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * LEADS ARRIVED. SMS DID NOT.
 *
 * ── THE ROOT CAUSE ─────────────────────────────────────────────────────────
 *
 * Not the provider, not the credentials, not the phone format. The pipeline
 * was sound end to end:
 *
 *   intakeLead -> queueSMS -> sms_logs row, status 'queued'
 *              -> /api/sms/queue claims a batch -> Arkesel transport
 *
 * and ARKESEL_API_KEY and CRON_SECRET are both configured in production.
 *
 * vercel.json had no `crons` block, so nothing ever called the drainer. The
 * rows accumulated as 'queued' for ever, and nothing reported a failure
 * because nothing had failed — no attempt was ever made. That is the worst
 * shape a fault can take: every component works, and the system does nothing.
 */

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('something actually drains the queue', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))

  test('a schedule exists at all', () => {
    assert.ok(Array.isArray(vercel.crons) && vercel.crons.length > 0,
      'with no crons block, every queued message waits for ever')
  })

  test('it calls the fan-out, so one entry covers every job', () => {
    const paths = vercel.crons.map((c: { path: string }) => c.path)
    assert.ok(paths.includes('/api/cron/run'),
      'the fan-out paces each task itself; scheduling it schedules all of them')
  })

  test('the daily schedule is a floor, not the whole answer', () => {
    /*
     * sms_queue declares everyMins: 5, and a five-minute cron expression is
     * refused on this plan — Hobby allows daily schedules only. A daily drain
     * alone would mean a marketer hears about Tuesday's lead on Wednesday.
     *
     * So the schedule is the overnight floor, and ordinary portal traffic
     * covers the working day. Both, not either.
     */
    const cron = vercel.crons.find((c: { path: string }) => c.path === '/api/cron/run')
    assert.match(cron.schedule, /^\d+ \d+ \* \* \*$/,
      `schedule is "${cron.schedule}" — this plan accepts a daily cron only`)
    assert.doesNotThrow(() => readFileSync('lib/cron/opportunistic.ts', 'utf8'),
      'a daily cron on its own leaves the working day uncovered')
  })

  test('traffic covers the working day', () => {
    const summary = codeOf('app/api/dashboard/summary/route.ts')
    assert.match(summary, /kickDueJobs\(\)/,
      'the request every staff member makes on opening the portal')
  })

  test('and it cannot delay or break the request it hangs off', () => {
    const kick = codeOf('lib/cron/opportunistic.ts')
    assert.match(kick, /after\(async \(\) => \{/, 'must run after the response is sent')
    assert.match(kick, /catch \{/, 'a failed drain must never surface to whoever loaded a dashboard')
    assert.ok(!/await kickDueJobs/.test(codeOf('app/api/dashboard/summary/route.ts')),
      'awaiting it would put the fan-out on the critical path')
  })

  test('it is rate limited, and defers to the fan-out for real pacing', () => {
    const kick = codeOf('lib/cron/opportunistic.ts')
    assert.match(kick, /CHECK_EVERY_MS/)
    assert.match(kick, /from\('cron_runs'\)/,
      'it asks whether anything is due before waking the fan-out')
  })

  test('consolidation survives being called constantly', () => {
    /*
     * The reason frequent calls are safe at all: notify-pending only picks up
     * marketers whose most recent lead has settled for three minutes, so five
     * leads still produce one message rather than five.
     */
    const notify = codeOf('app/api/leads/notify-pending/route.ts')
    assert.match(notify, /Date\.now\(\) - 3 \* 60000/)
    assert.match(notify, /\.lte\('last_lead_at', settleCutoff\)/)
  })

  test('the fan-out still paces jobs, so this does not run daily work 288 times', () => {
    const run = codeOf('app/api/cron/run/route.ts')
    assert.match(run, /now - \(lastRun\[t\.name\] \|\| 0\)\) >= t\.everyMins \* 60000/)
    assert.match(run, /from\('cron_runs'\)/)
  })

  test('and sms_queue is one of the tasks it calls', () => {
    const run = codeOf('app/api/cron/run/route.ts')
    assert.match(run, /path: '\/api\/sms\/queue'/)
  })

  test('the schedule authenticates the way the endpoint expects', () => {
    // Vercel sends Authorization: Bearer $CRON_SECRET on a scheduled call.
    const guard = codeOf('lib/auth/guard.ts')
    assert.match(guard, /req\.headers\.get\('authorization'\)\?\.replace\(\/\^Bearer\\s\+\/i, ''\)/)
    assert.match(codeOf('app/api/cron/run/route.ts'), /isValidCronRequest\(req\)/)
  })
})

describe('the pipeline reports what actually happened', () => {
  const queue = codeOf('lib/notifications/sms.ts')

  test('a queued message is not called sent', () => {
    /*
     * The distinction that makes the fault above diagnosable: a row sits at
     * 'queued' until an attempt is made, so "nothing is being sent" is
     * visible in the data rather than hidden behind an optimistic status.
     */
    assert.match(queue, /status: 'queued'/)
    assert.ok(!/status: 'sent'[\s\S]{0,200}insert\(/.test(queue),
      'a row must not be written as sent before it is attempted')
  })

  test('the provider is recorded on the row', () => {
    assert.match(queue, /provider: 'arkesel'/)
  })

  test('attempts and retries are tracked', () => {
    assert.match(queue, /attempts: 0/)
    assert.match(queue, /max_attempts: MAX_ATTEMPTS/)
    assert.match(queue, /next_retry_at/)
  })

  test('the number is normalised by the canonical rule before storage', () => {
    // normaliseRecipient rejects anything that is not a Ghanaian mobile, so a
    // number that could never be delivered to never enters the queue.
    assert.match(queue, /const recipient = normaliseRecipient\(opts\.to\)/)
    assert.match(queue, /if \(!recipient\) return \{ queued: false/)
  })

  test('a lead actually triggers one', () => {
    const intake = codeOf('lib/leadIntake.ts')
    assert.match(intake, /await queueSMS\(/)
    assert.match(intake, /dedupeKey: `new_lead_pm:/)
  })

  test('and the transport distinguishes a recorded message from a sent one', () => {
    /*
     * With no ARKESEL_API_KEY the transport records rather than sends and
     * says so, instead of reporting a success nobody received. The key IS
     * configured in production — but the distinction is what would have made
     * a missing one obvious rather than silent.
     */
    const sms = codeOf('lib/integrations/sms.ts')
    assert.match(sms, /recordingProviderFor\('sms'\)/)
    assert.match(sms, /recorded: true/)
  })
})
