/*
 * Import-free, so the shape rules are exercised directly in a test.
 */

/**
 * WHAT A NOTIFICATION ROW ACTUALLY HAS ON IT.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Fifteen inserts across nine files wrote a `link` column. The notifications
 * table has no such column, and PostgREST refuses the WHOLE statement when an
 * insert names one that does not exist — so every one of those notifications
 * failed, silently, and the bell never lit up.
 *
 * In-app notifications of a new lead stopped on 14 September. Four hundred
 * and forty-eight leads were assigned after that date, and not one of the
 * people they went to was told inside the portal. They were texted, which is
 * why this went unnoticed for six weeks: the texts were going out and the
 * delivery log said so.
 *
 * This is the second time this exact fault has been paid for here. The first
 * named lead_assign_pending.last_sms_at and silenced the same feature.
 *
 * So the column list is written down, in one place, with a test that sweeps
 * every insert in the application against it.
 */

/** Every column on `notifications`, as the database has them. */
export const NOTIFICATION_COLUMNS: readonly string[] = [
  'id', 'user_id', 'type', 'title', 'body', 'data', 'is_read', 'read_at', 'created_at',
]

/** Where a link goes, since there is no column for one. */
export type NotificationLike = {
  link?: string | null
  data?: { link?: string | null } | null
}

/**
 * Where this notification points, if anywhere.
 *
 * Reads `data.link` — where links are written — and still honours a top-level
 * `link`, so that if the column is ever added the bell does not have to
 * change again, and any row written before this keeps working.
 */
export function notificationLink(n: NotificationLike | null | undefined): string | null {
  if (!n) return null
  const direct = typeof n.link === 'string' ? n.link.trim() : ''
  if (direct) return direct
  const nested = typeof n.data?.link === 'string' ? n.data.link.trim() : ''
  return nested || null
}
