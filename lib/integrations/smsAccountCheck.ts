/*
 * No imports, by design. lib/integrations/sms.ts reaches for server-only
 * configuration and cannot be loaded by a test, so the rule for reading the
 * provider's answer lives here where it can be exercised directly — the same
 * arrangement as ./smsRecipient.
 */

/** What the provider's balance answer means. Never includes the key. */
export type AccountVerdict = {
  /** The provider recognised the key. Null when the check was inconclusive. */
  accepted: boolean | null
  /** Messages remaining, when the provider reported a usable number. */
  credits: number | null
  /** What to show. Null when there is nothing wrong. */
  error: string | null
}

/**
 * Read Arkesel's balance response.
 *
 * ── THE DISTINCTION THAT MATTERS ───────────────────────────────────────────
 *
 * Three outcomes, not two:
 *
 *   accepted: true   — the key works, and here is what is left in the account
 *   accepted: false  — the provider REFUSED it, and said so
 *   accepted: null   — the check did not complete
 *
 * The third must not collapse into the second. A timeout or a 502 from the
 * provider says nothing about the credential, and reporting it as "your key
 * is invalid" sends somebody rotating a working key in the middle of what is
 * already an outage — the same mistake as treating a failed RLS probe as a
 * pass, in the opposite direction.
 */
export function readBalanceResponse(status: number, body: unknown): AccountVerdict {
  const data = (body ?? {}) as { status?: string; message?: string; data?: { sms_balance?: unknown } }
  const message = String(data.message ?? '')

  if (status >= 200 && status < 300 && data.status === 'success') {
    const credits = Number(data.data?.sms_balance)
    return {
      accepted: true,
      credits: Number.isFinite(credits) ? credits : null,
      error: null,
    }
  }

  // A refusal the provider stated in so many words. Arkesel answers an
  // unusable key with {"message":"Invalid key"} and HTTP 200, so the body has
  // to be read as well as the status.
  if (status === 401 || status === 403 || /invalid key|authentication/i.test(message)) {
    return {
      accepted: false,
      credits: null,
      error: 'The SMS provider rejected this deployment’s API key. '
        + 'Sign-in codes cannot be sent by SMS until it is replaced.',
    }
  }

  return {
    accepted: null,
    credits: null,
    error: `The SMS provider answered ${status}${message ? ': ' + message : ''}, so this is inconclusive.`,
  }
}
