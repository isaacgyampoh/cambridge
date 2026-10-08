/**
 * Is an automation actually running as often as it claims?
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * /api/cron/run is a fan-out: one invocation runs every task whose interval
 * has elapsed. The intervals in that file — five minutes for the SMS queue,
 * ten for the lead sweep and the class reminder — describe the SPACING a task
 * wants, not a schedule anybody keeps. A task can only run when something
 * invokes the runner, so the real cadence is however often that happens.
 *
 * On Vercel's Hobby plan a scheduled job may run AT MOST ONCE A DAY, UTC, and
 * is only guaranteed within the hour. vercel.json asks for 06:00. So with
 * Vercel's own cron and nothing else, every task in the list runs once a day
 * whatever its interval says — and the automation screen was reporting "Runs
 * 10 min" beside each one regardless, which is a promise the deployment
 * cannot keep.
 *
 * That matters most for the automations whose whole value is being timely:
 * the class reminder is meant to arrive half an hour before a class, so once
 * a day at 06:00 it catches only a class starting around 06:30 and misses
 * every other one in silence.
 *
 * The page's own instructions already say to point an external pinger at the
 * runner every five minutes. This reports whether that is actually happening,
 * rather than assuming it.
 */

export type Cadence = 'on_schedule' | 'late' | 'never'

export type TaskRun = {
  task: string
  /** The spacing the task asks for, in minutes. */
  everyMins: number
  lastRunAt: string | null | undefined
}

/**
 * A task is late when more than twice its interval has passed.
 *
 * Twice, not once: the runner is a fan-out invoked on its own rhythm, so a
 * task with a ten-minute interval legitimately runs eleven or nineteen
 * minutes apart depending on when the ping lands. A grace of fifteen minutes
 * on top keeps the short intervals from crying late over ordinary jitter —
 * Vercel only guarantees a cron within its scheduled hour.
 */
export function cadenceOf(task: TaskRun, now: number): Cadence {
  if (!task.lastRunAt) return 'never'
  const at = new Date(task.lastRunAt).getTime()
  if (Number.isNaN(at)) return 'never'

  const elapsedMins = (now - at) / 60000
  const allowed = Math.max(task.everyMins * 2, task.everyMins + 15)
  return elapsedMins > allowed ? 'late' : 'on_schedule'
}

/** What to say beside one task. Plain words, no jargon. */
export function cadenceNote(task: TaskRun, now: number): string {
  switch (cadenceOf(task, now)) {
    case 'never':
      return 'Has never run'
    case 'late':
      return `Asks for every ${describeInterval(task.everyMins)} — not running that often`
    default:
      return `Every ${describeInterval(task.everyMins)}`
  }
}

export function describeInterval(mins: number): string {
  if (mins < 60) return `${mins} min`
  if (mins < 1440) return `${Math.round(mins / 60)} hour${mins >= 120 ? 's' : ''}`
  if (mins < 10080) return `${Math.round(mins / 1440)} day${mins >= 2880 ? 's' : ''}`
  return `${Math.round(mins / 10080)} week${mins >= 20160 ? 's' : ''}`
}

export type RunnerHealth = {
  /** Tasks wanting to run more than once a day that are not keeping up. */
  starved: string[]
  /** True when the pattern is "nothing runs more often than daily". */
  looksDaily: boolean
  headline: string | null
}

/**
 * The shape of the problem across all tasks, rather than one at a time.
 *
 * One late task is a task. Every sub-daily task late at once is a deployment
 * whose runner is only invoked daily, and saying so once is more use than
 * nine separate warnings.
 */
export function runnerHealth(tasks: TaskRun[], now: number): RunnerHealth {
  const subDaily = tasks.filter(t => t.everyMins < 1440)
  const starved = subDaily.filter(t => cadenceOf(t, now) === 'late').map(t => t.task)

  // Every one of them, and there are enough to mean something.
  const looksDaily = subDaily.length >= 3 && starved.length === subDaily.length

  if (looksDaily) {
    return {
      starved,
      looksDaily,
      headline:
        'Nothing is running more often than once a day. On Vercel’s free plan a ' +
        'scheduled job can only run once a day, so the automations below run once a ' +
        'day too — whatever interval they ask for. Set up the five-minute pinger ' +
        'described at the top of this page and they will keep their own times.',
    }
  }
  if (starved.length) {
    return {
      starved,
      looksDaily,
      headline: `${starved.length} automation${starved.length === 1 ? ' is' : 's are'} ` +
        'not running as often as they ask for.',
    }
  }
  return { starved: [], looksDaily: false, headline: null }
}
