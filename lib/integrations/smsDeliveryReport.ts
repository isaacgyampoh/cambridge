/*
 * No imports, by design — the same arrangement as ./smsAccountCheck and
 * ./smsRecipient. lib/integrations/sms.ts reaches for server-only
 * configuration and cannot be loaded by a test, so the rule for READING the
 * provider's answer lives here where it can be exercised directly.
 */

/**
 * WHAT THE NETWORK ACTUALLY DID WITH A MESSAGE.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * "Staff are not receiving the SMS for a PIN reset." The delivery screen said
 * every one of those messages was Delivered. It was wrong, and not by a
 * little: `status = 'sent'` means Arkesel ACCEPTED the message, which is the
 * last thing this system knew about it. Whether a handset ever received it is
 * a different fact, held by the provider and never asked for.
 *
 * Asked for it, the provider was unambiguous. Three messages sent within two
 * minutes of each other:
 *
 *   233244447134   DELIVERED
 *   233558659948   DELIVERED
 *   233244721555   NOT_DELIVERED      ← and this is the number that reported it
 *
 * Same sender, same kind of message, same minute. One number was not
 * receiving anything, and the portal had no way to say so — it showed a green
 * "Delivered" badge beside every one of them, which sent everybody looking
 * for a bug in the sending code that was working perfectly.
 */

/** What the provider says became of a message. */
export type DeliveryState =
  /** The handset received it. */
  | 'delivered'
  /** The network gave up: handset off, out of coverage, barred, or blocking this sender. */
  | 'undelivered'
  /** Accepted and still in flight. Ask again later. */
  | 'pending'
  /** The lookup did not answer, which says nothing about the message. */
  | 'unknown'

export type DeliveryReport = {
  state: DeliveryState
  /** The provider's own word, kept verbatim for the delivery log. */
  detail: string
}

/*
 * Arkesel's vocabulary. Anything outside it is 'unknown' rather than a guess
 * — a status we cannot read must not be recorded as a delivery or a failure,
 * because both of those are statements somebody will act on.
 */
const DELIVERED = new Set(['DELIVERED'])
const UNDELIVERED = new Set([
  'NOT_DELIVERED', 'UNDELIVERED', 'FAILED', 'REJECTED', 'EXPIRED', 'BLOCKED', 'DND',
])
const PENDING = new Set(['PENDING', 'SENT', 'SUBMITTED', 'ACCEPTED', 'QUEUED', 'IN_PROGRESS'])

/**
 * Read a per-message status response.
 *
 * `{"data":{"ID":"…","status":"DELIVERED","sender":"CambridgeCE", …}}`
 */
export function readDeliveryReport(status: number, body: unknown): DeliveryReport {
  const data = (body ?? {}) as { data?: { status?: unknown }; message?: unknown }

  if (status === 404) {
    /*
     * The provider has no record of it. That is not "not delivered" — it is
     * most often a reference from another account or a message old enough to
     * have been purged, and marking it undelivered would send somebody
     * chasing a handset over a bookkeeping difference.
     */
    return { state: 'unknown', detail: 'The provider has no record of this message.' }
  }
  if (status < 200 || status >= 300) {
    return { state: 'unknown', detail: `The provider answered ${status}.` }
  }

  const raw = String(data.data?.status ?? '').trim().toUpperCase()
  if (!raw) return { state: 'unknown', detail: 'The provider returned no status.' }

  if (DELIVERED.has(raw)) return { state: 'delivered', detail: raw }
  if (UNDELIVERED.has(raw)) return { state: 'undelivered', detail: raw }
  if (PENDING.has(raw)) return { state: 'pending', detail: raw }
  return { state: 'unknown', detail: raw }
}

/**
 * What to tell an administrator about a message the network did not deliver.
 *
 * Deliberately not "it failed". The send worked; the message reached the
 * network and the network could not put it on a handset, and the three
 * reasons for that are all at the far end — which is where the person asking
 * "why didn't they get it?" needs to be pointed.
 */
export function undeliveredExplanation(detail: string): string {
  return `The network did not deliver it (${detail}). The handset may be switched off or out of `
    + 'coverage, the number may no longer be in use, or it may be blocking messages from this '
    + 'sender. Resending will not change it — check the number with the person directly.'
}
