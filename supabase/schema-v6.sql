-- Schema v6: Flexible permissions system
-- Each staff member has a base role + custom portal access list

-- Add permissions column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS
  portals TEXT[] DEFAULT NULL;
-- NULL means use role defaults
-- ['leads','admissions','finance'] means only those portals regardless of role

-- Add full_name index for fast phone lookups
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Update the profiles RLS to allow service role full access (needed for PIN auth)
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
