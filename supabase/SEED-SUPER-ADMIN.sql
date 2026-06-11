-- ============================================================
-- QUICK SEED: Creates Super Admin directly
-- Run this in Supabase SQL Editor if first-run endpoint fails
-- ============================================================

-- First check if profiles table exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profiles') THEN
    RAISE EXCEPTION 'profiles table does not exist. Run FULL-SCHEMA.sql first!';
  END IF;
END $$;

-- Add portals column if missing (schema-v6)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS portals TEXT[] DEFAULT NULL;

-- Check if super admin already exists
DO $$
DECLARE
  admin_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM profiles WHERE role = 'super_admin') INTO admin_exists;
  IF admin_exists THEN
    RAISE NOTICE 'Super admin already exists - updating PIN to 1024';
    UPDATE profiles
    SET
      pin_hash = encode(digest('1024' || 'cce-pin-salt-cambridge-2024', 'sha256'), 'hex'),
      must_change_pin = true,
      is_active = true,
      phone = COALESCE(phone, '233201024000'),
      locked_until = NULL,
      login_attempts = 0
    WHERE role = 'super_admin';
    RETURN;
  END IF;
END $$;

-- Insert super admin profile linked to a placeholder auth user
-- NOTE: You must also create the Supabase Auth user separately
-- OR use the /api/auth/first-run endpoint after the schema is set up

-- The PIN hash below is SHA256('1024' + 'cce-pin-salt-cambridge-2024')
-- You can verify: SELECT encode(digest('1024cce-pin-salt-cambridge-2024', 'sha256'), 'hex');

SELECT
  'Run this after creating auth user via first-run endpoint' as note,
  encode(digest('1024cce-pin-salt-cambridge-2024', 'sha256'), 'hex') as pin_1024_hash;
