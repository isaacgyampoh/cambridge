/**
 * The master switch for fee reminders.
 *
 * Isaac asked for payment reminders to be turned off. They were going out
 * daily, unattended, to every student carrying a balance — `payment_reminders`
 * sits in the cron fan-out on a 1440-minute interval. (The run route's own
 * docstring claimed it was "NOT wired to auto-run by default". That comment
 * was stale: it has been in the TASKS list and firing daily.)
 *
 * This module is pure so the decision can be tested without a database. The
 * read lives at each send site.
 */

/** The `settings` row that decides it. */
export const REMINDERS_KEY = 'payment_reminders_enabled'

/**
 * Note the polarity: reminders send ONLY when the row explicitly says 'true'.
 *
 * `auto_assign_leads` is the opposite — absent means on — and that is right
 * for it, because an unassigned lead is worse than a mis-assigned one. Here
 * the asymmetry runs the other way. A missing or unreadable setting must not
 * send a few hundred people a message about money they owe; silence is the
 * recoverable failure, so absence means OFF.
 */
export function remindersEnabled(raw: string | null | undefined): boolean {
  return raw === 'true'
}

/** Said to whoever triggered it, and recorded in cron_runs. */
export const DISABLED_REASON =
  'Fee reminders are switched off in Settings. Nothing was sent.'

/**
 * Is this invoice past its due date?
 *
 * The invoice reminder route decided this by comparing its own FORMATTED due
 * date against an ISO timestamp:
 *
 *   dueDate < new Date().toISOString() ? 'overdue' : 'balance'
 *
 * where dueDate was already "5 October 2026", or the sentence "as soon as
 * possible". That is a character comparison, so the answer came down to the
 * first digit of the DAY OF THE MONTH: "1 December 2026" sorts before "2026…"
 * and was called overdue though it is months away, while "30 September 2026"
 * sorts after it and was called current though it has passed. Wrong in both
 * directions, and nothing to do with time.
 *
 * A missing or unparseable date is not overdue: it is unknown, and guessing in
 * the harsher direction is how a paid-up student gets chased.
 */
export function isOverdue(dueDate: string | null | undefined, now: number): boolean {
  if (!dueDate) return false
  const at = new Date(dueDate).getTime()
  if (Number.isNaN(at)) return false
  return at < now
}

/** What a student reads as the deadline. */
export const NO_DUE_DATE = 'as soon as possible'

export function formatDueDate(dueDate: string | null | undefined): string {
  if (!dueDate) return NO_DUE_DATE
  const at = new Date(dueDate)
  if (Number.isNaN(at.getTime())) return NO_DUE_DATE
  return at.toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })
}
