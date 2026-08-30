import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { clientIp } from '@/lib/auth/rateLimit'
import type { NextRequest } from 'next/server'

/**
 * Audit logging.
 *
 * The `audit_logs` table has existed in the schema from the beginning, but
 * nothing in the application ever wrote to it — there was no record of who
 * created a member of staff, changed a role, edited a payment or purged a
 * lead. This module is the one place that writes it.
 *
 * Two rules the migration enforces at the database level:
 *   - the table is append-only (no UPDATE or DELETE policy, for anyone), so a
 *     record cannot be quietly rewritten after the fact;
 *   - RLS is on, so the public anon key cannot read or empty it.
 *
 * Never pass a PIN, session token, OTP or API key in `metadata`.
 */

export type AuditEvent = {
  /** Who did it. Null for anonymous or system-initiated actions. */
  actorId?: string | null
  /** What they did, as `resource.verb` — e.g. `staff.created`, `payment.voided`. */
  action: string
  /** The table or domain object affected. */
  resource: string
  /** Primary key of the affected row, when there is one. */
  resourceId?: string | null
  /** Did the attempt succeed? Failures are worth recording too. */
  success: boolean
  /** Any extra context. Must not contain credentials. */
  metadata?: Record<string, unknown>
  /** Passed so the actor's IP and user agent can be recorded. */
  request?: NextRequest | Request
}

/** Keys that must never reach the audit table, whatever the caller passes. */
const FORBIDDEN = /pin|password|token|secret|otp|key|authorization|cookie/i

function scrub(metadata?: Record<string, unknown>): Record<string, unknown> | null {
  if (!metadata) return null
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(metadata)) {
    clean[k] = FORBIDDEN.test(k) ? '[redacted]' : v
  }
  return clean
}

/**
 * Write one audit record.
 *
 * Deliberately never throws: an audit write failing must not roll back or
 * break the operation the user actually asked for. Failures are logged to the
 * server console so they surface in Vercel's logs.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    const sb = createServiceClient()
    // Column names follow the audit_logs table as it already exists
    // (user_id / table_name / record_id); the migration only ADDS the
    // success, metadata and user_agent columns rather than reshaping it,
    // so any rows already present stay valid.
    await sb.from('audit_logs').insert({
      user_id: event.actorId ?? null,
      action: event.action,
      table_name: event.resource,
      record_id: event.resourceId ?? null,
      success: event.success,
      metadata: scrub(event.metadata),
      ip_address: event.request ? clientIp(event.request) : null,
      user_agent: event.request?.headers.get('user-agent')?.slice(0, 300) ?? null,
    })
  } catch (e) {
    console.error('[audit] failed to record', event.action, e)
  }
}
