-- ============================================================================
-- 0015 — ACCOUNT RECOVERY THAT DOES NOT BECOME A BACKDOOR
--
-- Run AFTER 0014. Adds four nullable columns to profiles. Nothing is dropped
-- and no existing credential is touched.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────────────
--
-- Sign-in is PIN-only. When somebody forgets their PIN there is nothing else
-- to identify them by, so the only route back in was a developer editing the
-- database — which is not a product, and which had already happened once.
--
-- ── WHY A RECOVERY PIN IS NOT A SECOND PASSWORD ────────────────────────────
--
-- A fixed recovery PIN that logs you straight in would be a universal
-- backdoor: four digits, ten thousand guesses, full access. So the recovery
-- PIN proves nothing on its own. It only opens a flow that STILL requires a
-- one-time code sent to the account's registered corporate email:
--
--     recovery PIN  →  OTP to the corporate mailbox  →  choose a new PIN
--
-- Whoever holds the recovery PIN cannot get in without also holding the
-- mailbox. That is the same second factor normal sign-in uses, so recovery is
-- no weaker than the front door.
--
-- The reset token issued after the OTP is NOT a session. It authorises exactly
-- one action — setting a new PIN — is single use, expires in fifteen minutes,
-- and is never accepted by the proxy for anything else.
--
-- ── WHY IT SURVIVES A PIN CHANGE ───────────────────────────────────────────
--
-- The recovery PIN is stored separately from the account PIN and is not
-- touched when the account PIN changes. Somebody who recovers their account,
-- chooses a new PIN and then forgets THAT one can recover again. The previous
-- design made recovery a one-shot, which is precisely how the super admin
-- ended up locked out a second time.
-- ============================================================================

BEGIN;

/*
 * Hashed exactly like the account PIN — scrypt with a per-user salt and the
 * server pepper. A database dump yields nothing replayable, and no code path
 * anywhere returns or logs it.
 */
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recovery_pin_hash    TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recovery_pin_set_at  TIMESTAMPTZ;

/*
 * The single-use permission to set a new PIN, held between the OTP step and
 * the new-PIN step. Stored hashed for the same reason session tokens are.
 */
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reset_token_hash       TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

-- Recovery identifies an account by its recovery PIN alone, so every active
-- account with one is checked on each attempt. Partial: most rows have none.
CREATE INDEX IF NOT EXISTS idx_profiles_recovery
  ON profiles(id) WHERE recovery_pin_hash IS NOT NULL;

-- Looked up once per reset completion.
CREATE INDEX IF NOT EXISTS idx_profiles_reset_token
  ON profiles(reset_token_hash) WHERE reset_token_hash IS NOT NULL;

/*
 * These columns are credentials. The data policy already refuses to read or
 * write anything matching pin/token/secret, but the denylist is enumerated by
 * name, so they are added explicitly rather than assumed to be covered.
 */
COMMENT ON COLUMN profiles.recovery_pin_hash IS
  'scrypt hash of the account recovery PIN. Never returned by any API.';
COMMENT ON COLUMN profiles.reset_token_hash IS
  'sha256 of a single-use PIN-reset token. Not a session; grants only the set-new-PIN action.';

COMMIT;
