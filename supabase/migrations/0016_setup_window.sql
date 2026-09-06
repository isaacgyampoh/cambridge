-- ============================================================================
-- 0016 — A TIME-LIMITED, SINGLE-USE PROVISIONING WINDOW
--
-- Run AFTER 0015. One table. Nothing existing is touched.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────────────
--
-- Provisioning the super admin has to be authorised by SETUP_SECRET, which
-- lives only in the deployment environment. The person who owns the system
-- cannot read it — it is marked Sensitive in Vercel precisely so that nobody
-- can — so they cannot present it in a browser.
--
-- The obvious workarounds are both wrong:
--
--   · a public "provision the super admin" button is a takeover button
--   · showing the secret in the browser defeats the point of the secret
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────
--
-- Authorisation and use are separated in time.
--
--   OPEN    someone holding SETUP_SECRET opens a window, server-side.
--           Nothing is provisioned and no credential exists yet.
--
--   CLAIM   within the window, the setup page provisions once, in the
--           browser, without any secret. The claim closes the window
--           permanently.
--
-- The window is the authorisation, carried forward in time. It is single use,
-- short lived, and recorded — so "who provisioned this system, and on whose
-- authority" has an answer.
--
-- ── THE RESIDUAL RISK, STATED PLAINLY ──────────────────────────────────────
--
-- While a window is open, anyone who reaches the setup page can claim it. The
-- window is therefore minutes long, single use, and meant to be opened
-- immediately before it is used — not left standing. That is a deliberate
-- trade against the alternative, which is an owner who can never provision
-- their own system without a terminal.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS setup_windows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * sha256 of the window's token, never the token. The setup page does not
   * hold it either — the window is identified by being the one open row.
   * Stored hashed so a database dump cannot be replayed into a claim.
   */
  token_hash   TEXT NOT NULL,

  /** 'provision' — creating or resetting the super admin's credentials. */
  purpose      TEXT NOT NULL DEFAULT 'provision',

  /*
   * Whether this window is permitted to REPLACE an existing super admin's
   * credentials. Opening a window does not, by itself, authorise overwriting
   * a working account — that has to be asked for deliberately.
   */
  allow_reset  BOOLEAN NOT NULL DEFAULT FALSE,

  opened_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,

  /** Set when the window is spent. A window is claimable exactly once. */
  claimed_at   TIMESTAMPTZ,
  claimed_ip   TEXT,

  /** What the claim produced, for the audit trail. Never a credential. */
  outcome      TEXT
);

-- The claim path asks one question: is there an open, unexpired, unclaimed
-- window? This is the index that answers it.
CREATE INDEX IF NOT EXISTS idx_setup_windows_open
  ON setup_windows(expires_at)
  WHERE claimed_at IS NULL;

ALTER TABLE setup_windows ENABLE ROW LEVEL SECURITY;

/*
 * No policy, so this is a default deny for the anon and authenticated keys.
 * Only the service role reaches it, which is what the setup routes use.
 * A window is an authorisation record; nothing in a browser should read it.
 */

COMMENT ON TABLE setup_windows IS
  'Single-use, time-limited authorisation to provision the super admin. Opened server-side with SETUP_SECRET; claimed once from the setup page.';

COMMIT;
