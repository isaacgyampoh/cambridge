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

  test('often enough for a five-minute job to run every five minutes', () => {
    /*
     * sms_queue declares everyMins: 5. A daily schedule would leave a lead's
     * notification sitting until the next morning, which for "a new lead is
     * waiting" is the same as not sending it.
     */
    const smsCron = vercel.crons.find((c: { path: string }) => c.path === '/api/cron/run')
    assert.match(smsCron.schedule, /^\*\/[1-5] \* \* \* \*$/,
      `schedule is "${smsCron.schedule}" — too infrequent for a 5-minute task`)
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
