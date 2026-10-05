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
