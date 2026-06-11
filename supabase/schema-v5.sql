-- ============================================================
-- SCHEMA v5 — PIN Authentication + Role Isolation
-- Run AFTER all previous schemas
-- ============================================================

-- ── PIN STORAGE ───────────────────────────────────────────────
-- We store a bcrypt hash of the PIN (never plain text)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS login_attempts INT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN DEFAULT false;

-- ── STAFF INVITE TOKENS ──────────────────────────────────────
-- Super admin creates invite → staff uses token to self-register
CREATE TABLE IF NOT EXISTS staff_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  email TEXT NOT NULL,
  role user_role NOT NULL,
  full_name TEXT,
  phone TEXT,
  department TEXT,
  initial_pin TEXT NOT NULL, -- plain text shown once to admin, then hashed on use
  created_by UUID REFERENCES profiles(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  is_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SESSION TOKENS (server-side PIN sessions) ────────────────
CREATE TABLE IF NOT EXISTS pin_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '8 hours',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUDIT: login events ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  email TEXT,
  event_type TEXT NOT NULL, -- 'success', 'wrong_pin', 'locked', 'logout'
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pin_sessions_token ON pin_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_pin_sessions_user ON pin_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_staff_invites_token ON staff_invites(token, is_used);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_sessions ENABLE ROW LEVEL SECURITY;

-- Only super admin can manage invites
CREATE POLICY "invites_admin" ON staff_invites FOR ALL
  USING (get_my_role() = 'super_admin');

-- Sessions: own only
CREATE POLICY "sessions_own" ON pin_sessions FOR ALL
  USING (user_id = auth.uid());

-- ── FUNCTION: verify PIN session token ───────────────────────
CREATE OR REPLACE FUNCTION verify_session_token(p_token TEXT)
RETURNS TABLE(user_id UUID, role user_role, full_name TEXT, is_valid BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.user_id,
    p.role,
    p.full_name,
    (ps.expires_at > NOW() AND p.is_active = true) AS is_valid
  FROM pin_sessions ps
  JOIN profiles p ON p.id = ps.user_id
  WHERE ps.session_token = p_token;
END;
$$;

-- ── INITIAL SUPER ADMIN SETUP ─────────────────────────────────
-- This creates the super admin account via a one-time setup
-- PIN: 1024 (hashed) — admin must change on first login
-- crypt('1024', gen_salt('bf')) → bcrypt hash
-- We store the hash; the API verifies with crypt(input, stored_hash) = stored_hash

-- NOTE: Run the /api/auth/first-run endpoint instead — it handles this safely
